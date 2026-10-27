// The blue checkered "time tunnel" behind the time-travel cinematic, as a screen-space
// shader. Measured from the original at 1080p:
//  - centred on the view; with ρ = distance from the centre / (base / 2) and u = 1 / ρ
//    (u is proportional to depth along the tunnel), the wall is a checkerboard of
//    8 angular sectors x rings 0.25 apart in u;
//  - the sector boundaries are helices: θ - 0.806 u is constant along them (clockwise
//    deeper in, on screen);
//  - colour fades from blue-grey at the edges to a pale centre (a radial LUT), with a
//    checker contrast of ~12 levels at the edges down to ~5 near the centre;
//  - the rings stream inwards only while the camera flies (8 rings per board passed);
//    the sector helices stay put.

import * as THREE from 'three'

export const VORTEX_SECTORS = 8
export const VORTEX_RING = 0.25
export const VORTEX_TWIST = 0.806
/** Pattern phases at rest (fitted to the original). */
export const VORTEX_SECTOR_PHASE = 0.0
export const VORTEX_RING_PHASE = 0.183

/** Radial colour profile: [ρ, r, g, b, light-dark contrast] (sRGB 0..255). */
export const VORTEX_LUT: readonly (readonly [number, number, number, number, number])[] = [
  [0.0, 153, 162, 180, 4],
  [0.15, 151, 161, 179, 4],
  [0.2, 150, 159, 180, 4],
  [0.26, 149, 158, 179, 4],
  [0.3, 148, 157, 178, 4],
  [0.35, 146, 156, 177, 4.5],
  [0.41, 144, 155, 176, 5],
  [0.47, 142, 153, 175, 5],
  [0.55, 140, 151, 176, 6],
  [0.63, 137, 149, 174, 6.5],
  [0.72, 135, 147, 173, 6.5],
  [0.82, 131, 144, 172, 6.5],
  [0.94, 129, 142, 171, 7],
  [1.1, 124, 139, 169, 7],
  [1.27, 120, 136, 167, 7],
  [1.47, 116, 133, 167, 8],
  [1.66, 112, 130, 164, 9],
  [1.86, 109, 127, 163, 9.5],
  [2.1, 111, 129, 164, 9.5],
  [3.0, 111, 129, 164, 10],
]

const LUT_SIZE = 256
const LUT_MAX_RHO = 3

/** Piecewise-linear lookup of the radial profile (exported for tests and the menu backdrop). */
export function vortexProfile(rho: number): [number, number, number, number] {
  const L = VORTEX_LUT
  if (rho <= L[0][0]) return [L[0][1], L[0][2], L[0][3], L[0][4]]
  for (let i = 1; i < L.length; i++) {
    if (rho <= L[i][0]) {
      const a = L[i - 1]
      const b = L[i]
      const t = (rho - a[0]) / (b[0] - a[0])
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t]
    }
  }
  const z = L[L.length - 1]
  return [z[1], z[2], z[3], z[4]]
}

function lutTexture(): THREE.DataTexture {
  const data = new Uint8Array(LUT_SIZE * 4)
  for (let i = 0; i < LUT_SIZE; i++) {
    const [r, g, b, c] = vortexProfile((i / (LUT_SIZE - 1)) * LUT_MAX_RHO)
    data[i * 4] = Math.round(r)
    data[i * 4 + 1] = Math.round(g)
    data[i * 4 + 2] = Math.round(b)
    data[i * 4 + 3] = Math.round(c * 8) // contrast, scaled for precision
  }
  const tex = new THREE.DataTexture(data, LUT_SIZE, 1, THREE.RGBAFormat)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

export interface VortexLayer {
  mesh: THREE.Mesh
  /** Rings travelled inwards (fractional). */
  setRings(rings: number): void
  setOpacity(a: number): void
  /** Centre (CSS px from the top-left), base size (CSS px) and device pixel ratio. */
  setView(cx: number, cy: number, base: number, width: number, height: number, dpr: number): void
  dispose(): void
}

/** A full-screen quad for an orthographic camera in CSS pixels (x right, y down, z towards the viewer). */
export function createVortex(): VortexLayer {
  const lut = lutTexture()
  const uniforms = {
    lut: { value: lut },
    center: { value: new THREE.Vector2(0, 0) },
    halfBase: { value: 500 },
    rings: { value: 0 },
    opacity: { value: 0 },
    dpr: { value: 1 },
  }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vPx;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vPx = w.xy;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D lut;
      uniform vec2 center;
      uniform float halfBase;
      uniform float rings;
      uniform float opacity;
      uniform float dpr;
      varying vec2 vPx;
      const float PI = 3.14159265358979;
      // anti-aliased square wave in [-1, 1] (+1 on the first half of each period)
      float sq(float x, float w) {
        float f = fract(x);
        float a = smoothstep(-w, w, f) - smoothstep(0.5 - w, 0.5 + w, f) + smoothstep(1.0 - w, 1.0 + w, f);
        return a * 2.0 - 1.0;
      }
      vec3 toLinear(vec3 c) {
        return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
      }
      void main() {
        vec2 d = vPx - center;              // y down, as on screen
        float r = max(length(d), 0.5);
        float rho = r / halfBase;
        float u = halfBase / r;
        float th = atan(d.y, d.x);
        float s = ${VORTEX_SECTORS.toFixed(1)} * (th - ${VORTEX_TWIST.toFixed(4)} * u) / (2.0 * PI) + ${VORTEX_SECTOR_PHASE.toFixed(4)};
        float t = u / ${VORTEX_RING.toFixed(4)} - rings + ${VORTEX_RING_PHASE.toFixed(4)};
        // pixel footprint of the pattern (in cells) for anti-aliasing
        float px = 1.0 / dpr;
        float ws = clamp(${VORTEX_SECTORS.toFixed(1)} / (2.0 * PI * r) * px * 0.7, 0.002, 0.5);
        float wt = clamp(halfBase / (r * r) / ${VORTEX_RING.toFixed(4)} * px * 0.7, 0.002, 0.5);
        float checker = sq(s * 0.5, ws * 0.5) * sq(t * 0.5, wt * 0.5);
        // fade the contrast where the rings get finer than a couple of pixels
        float fine = 1.0 - smoothstep(0.12, 0.45, wt);
        vec4 prof = texture2D(lut, vec2(clamp(rho / ${LUT_MAX_RHO.toFixed(1)}, 0.0, 1.0), 0.5));
        float contrast = prof.a * 255.0 / 8.0 / 255.0;
        vec3 col = prof.rgb + vec3(0.5 * contrast * checker * fine);
        gl_FragColor = vec4(toLinear(clamp(col, 0.0, 1.0)), opacity);
        #include <colorspace_fragment>
      }`,
  })
  const geo = new THREE.PlaneGeometry(1, 1)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  return {
    mesh,
    setRings(n) {
      uniforms.rings.value = n
    },
    setOpacity(a) {
      uniforms.opacity.value = a
      mesh.visible = a > 0.001
    },
    setView(cx, cy, base, width, height, dpr) {
      uniforms.center.value.set(cx, cy)
      uniforms.halfBase.value = base / 2
      uniforms.dpr.value = dpr
      mesh.scale.set(width, height, 1)
      mesh.position.set(width / 2, height / 2, 0)
    },
    dispose() {
      geo.dispose()
      mat.dispose()
      lut.dispose()
    },
  }
}
