import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { POSES, blendPose, boardMatrix, cameraBasis, isFlat, light3D, placeCamera, targetHeight, viewEase, BOARD_LIFT_3D } from '../views'
import { CameraRig } from '../camera'
import { computeLayout, squareAt, squareOffset, timelineName } from '../layout'
import { markerArrow, resolveView } from '../renderer'
import { fixtures } from '../demo/fixtures'

const byId = (id: string) => fixtures().find((f) => f.id === id)!.model
const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('view poses', () => {
  it('2D is the plain top-down view; the 3D views stand the boards up', () => {
    expect(isFlat(POSES['2d'])).toBe(true)
    expect(isFlat(POSES.history)).toBe(false)
    expect(POSES.history.tilt).toBeCloseTo(Math.PI / 2)
    expect(POSES.parallel.tilt).toBeCloseTo(Math.PI / 2)
    // measured from the original: ~37 deg up; History looks back along time, Parallel across timelines
    for (const p of [POSES.history, POSES.parallel]) expect(THREE.MathUtils.radToDeg(p.elev)).toBeGreaterThan(30)
    const flat = (v: THREE.Vector3) => new THREE.Vector2(v.x, v.y).normalize()
    const fh = flat(cameraBasis(POSES.history).forward)
    const fp = flat(cameraBasis(POSES.parallel).forward)
    expect(fh.x).toBeLessThan(-0.8) // towards the past
    expect(fp.y).toBeGreaterThan(0.8) // from white's side across the timelines
  })

  it('blends every field linearly and the transition ease is monotonic from 0 to 1', () => {
    const mid = blendPose(POSES['2d'], POSES.history, 0.5)
    close(mid.elev, (POSES['2d'].elev + POSES.history.elev) / 2)
    close(mid.yaw, POSES.history.yaw / 2)
    close(mid.s, 0.5)
    expect(viewEase(0)).toBe(0)
    expect(viewEase(1)).toBe(1)
    let prev = 0
    for (let i = 1; i <= 50; i++) {
      const v = viewEase(i / 50)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
    expect(viewEase(0.4)).toBeGreaterThan(0.6) // most of the motion early, soft settle
  })

  it('in 2D the camera looks straight down with +y up on screen', () => {
    const b = cameraBasis(POSES['2d'])
    close(b.forward.z, -1)
    close(b.up.y, 1)
    close(b.right.x, 1)
    expect(targetHeight(POSES['2d'])).toBe(0)
  })

  it('3D shadows fall away from the camera', () => {
    for (const p of [POSES.history, POSES.parallel]) {
      const l = light3D(p, 1)
      const f = cameraBasis(p).forward
      expect(l.x * f.x + l.y * f.y).toBeGreaterThan(0.5)
    }
  })
})

describe('board placement', () => {
  const h = 0.882
  it('flat boards are centred on their slot', () => {
    const m = boardMatrix(POSES['2d'], 3, -1, h)
    const c = new THREE.Vector3().applyMatrix4(m)
    close(c.x, 3)
    close(c.y, -1)
  })

  it('Parallel View: boards stand on their row facing -y, files along +x', () => {
    const m = boardMatrix(POSES.parallel, 3, -1, h)
    const bottom = new THREE.Vector3(0, -h / 2, 0).applyMatrix4(m)
    close(bottom.x, 3)
    close(bottom.y, -1)
    close(bottom.z, BOARD_LIFT_3D)
    const top = new THREE.Vector3(0, h / 2, 0).applyMatrix4(m)
    close(top.z, BOARD_LIFT_3D + h, 1e-5)
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m)
    close(n.y, -1, 1e-6)
    const files = new THREE.Vector3(1, 0, 0).transformDirection(m)
    close(files.x, 1)
  })

  it('History View: boards face the future (+x), files along +y', () => {
    const m = boardMatrix(POSES.history, 3, -1, h)
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m)
    close(n.x, 1, 1e-6)
    const files = new THREE.Vector3(1, 0, 0).transformDirection(m)
    close(files.y, 1, 1e-6)
    const bottom = new THREE.Vector3(0, -h / 2, 0).applyMatrix4(m)
    close(bottom.x, 3)
    close(bottom.y, -1)
  })
})

describe('camera and picking', () => {
  const W = 1600
  const H = 900
  for (const mode of ['2d', 'history', 'parallel'] as const) {
    it(`${mode}: the target is at the screen centre and square picks round-trip`, () => {
      const rig = new CameraRig()
      rig.setSize(W, H)
      rig.setView(mode, 0)
      rig.state = { cx: 2, cy: -0.5, zoom: 230 }
      rig.update()
      const centre = rig.project(new THREE.Vector3(2, -0.5, targetHeight(rig.pose)))
      close(centre.x, W / 2, 1e-3)
      close(centre.y, H / 2, 1e-3)
      // a board: project square centres to the screen, ray-cast back through the board plane
      const L = computeLayout(byId('start'))
      const p = L.boardsByKey.get('0:2')!
      const m = boardMatrix(rig.pose, p.x, p.y, p.h)
      const inv = m.clone().invert()
      for (const [x, y] of [[0, 0], [7, 7], [4, 1], [2, 6]]) {
        const o = squareOffset(p, x, y, L.flip)
        const s = rig.project(new THREE.Vector3(o.x, o.y, 0).applyMatrix4(m))
        const ray = rig.setRay(s.x, s.y).ray
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
          new THREE.Vector3(0, 0, 1).transformDirection(m),
          new THREE.Vector3().setFromMatrixPosition(m),
        )
        const hit = ray.intersectPlane(plane, new THREE.Vector3())!
        const local = hit.applyMatrix4(inv)
        expect(squareAt(p, local.x / p.w + 0.5, local.y / p.h + 0.5, L.flip)).toEqual({ x, y })
      }
    })
  }

  it('mid-transition poses still give an exact pick', () => {
    const rig = new CameraRig()
    rig.setSize(W, H)
    rig.pose = blendPose(POSES['2d'], POSES.parallel, 0.37)
    rig.state = { cx: 0, cy: 0, zoom: 180 }
    rig.update()
    const m = boardMatrix(rig.pose, 0, 0, 0.88)
    const world = new THREE.Vector3(0.1, -0.2, 0).applyMatrix4(m)
    const s = rig.project(world)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).transformDirection(m), new THREE.Vector3().setFromMatrixPosition(m))
    const hit = rig.setRay(s.x, s.y).ray.intersectPlane(plane, new THREE.Vector3())!
    expect(hit.distanceTo(world)).toBeLessThan(1e-4)
  })

  it('wheel zoom eases towards its goal and keeps the point under the cursor', () => {
    const rig = new CameraRig()
    rig.setSize(W, H)
    rig.state = { cx: 0, cy: 0, zoom: 100 }
    rig.update()
    const anchor = rig.screenToGround(1200, 300)!.clone()
    rig.zoomSmooth(2, 1200, 300)
    let t = 1000
    rig.tick(t)
    const zooms: number[] = []
    for (let i = 0; i < 40; i++) {
      t += 1000 / 60
      rig.tick(t)
      zooms.push(rig.state.zoom)
      const g = rig.screenToGround(1200, 300)!
      expect(g.distanceTo(anchor)).toBeLessThan(1e-6)
    }
    // no single-frame jump: the first frame moves only part of the way, later frames continue
    expect(zooms[0]).toBeLessThan(150)
    expect(zooms[0]).toBeGreaterThan(100)
    close(zooms[zooms.length - 1], 200, 1e-6)
  })

  it('drags glide on every frame, coast a little, and the bounds pull the target back', () => {
    const rig = new CameraRig()
    rig.setSize(W, H)
    rig.state = { cx: 0, cy: 0, zoom: 100 }
    rig.setLimits({ box: { minX: -1, maxX: 1, minY: -1, maxY: 1 }, margin: 0.5, minZoom: 50, maxZoom: 400 })
    rig.update()
    let t = 1000
    rig.tick(t)
    rig.hold(true)
    rig.dragBy(1, 0)
    t += 16
    rig.tick(t)
    expect(rig.state.cx).toBeGreaterThan(0)
    expect(rig.state.cx).toBeLessThan(1)
    for (let i = 0; i < 30; i++) {
      t += 16
      rig.tick(t)
    }
    close(rig.state.cx, 1, 1e-3)
    // drag far out of bounds: resistance, then a spring back on release
    for (let i = 0; i < 50; i++) {
      rig.dragBy(0.2, 0)
      rig.tick((t += 16))
    }
    for (let i = 0; i < 30; i++) rig.tick((t += 16))
    expect(rig.state.cx).toBeLessThan(6) // 10 units of drag, strongly resisted
    expect(rig.state.cx).toBeGreaterThan(1.5)
    rig.hold(false)
    for (let i = 0; i < 200; i++) rig.tick((t += 16))
    expect(rig.state.cx).toBeLessThanOrEqual(1.5 + 1e-6)
  })

  it('places an orthographic camera for every pose', () => {
    const cam = new THREE.OrthographicCamera()
    placeCamera(cam, POSES.history, 1, 2, 200, 800, 600)
    close(cam.right - cam.left, 800 / 200)
    close(cam.top - cam.bottom, 600 / 200)
  })
})

describe('layout additions', () => {
  it('labels timelines one row beyond the outermost ones, right of the furthest arrow', () => {
    const L = computeLayout(byId('multi'))
    const tls = L.labels.filter((l) => l.align === 'right')
    const names = tls.map((l) => l.text)
    expect(names).toContain('0L')
    expect(names).toContain('+1L')
    const maxEnd = Math.max(...L.timelines.map((t) => t.endX))
    for (const l of tls) close(l.x, maxEnd + 1.47)
    const zero = tls.find((l) => l.text === '0L')!
    expect(zero.y).toBe(0)
    expect(timelineName(-2)).toBe('-2L')
    expect(timelineName(1.5)).toBe('+1L')
    expect(timelineName(-0.5)).toBe('-0L')
  })

  it('puts turn labels at the centre of each full-turn cell below the lowest row', () => {
    const L = computeLayout(byId('multi'))
    const turns = L.labels.filter((l) => l.align === 'center')
    const t1 = turns.find((l) => l.text === 'T1')!
    close(t1.x, 2.5) // T1 = half-turns 2 and 3
    const lowest = Math.min(...L.timelines.map((t) => t.y))
    close(t1.y, lowest - 1.37)
  })

  it('starting timelines get a soft tail; branches do not', () => {
    const L = computeLayout(byId('branch'))
    const main = L.timelines.find((t) => t.l === 0)!
    const branch = L.timelines.find((t) => t.l !== 0)!
    expect(main.tail).toBeGreaterThan(0)
    expect(branch.tail).toBe(0)
    const first = Math.min(...L.boards.filter((b) => b.l === 0).map((b) => b.x))
    close(main.path[0].x, first - 1.5)
  })

  it('centres the present-marker arrow glyph on its circle, both directions', () => {
    for (const dir of [1, -1] as const) {
      const { shaft, head } = markerArrow(0, 0, dir, 1)
      const ys = [...shaft, ...head].map((p) => p.y)
      close((Math.min(...ys) + Math.max(...ys)) / 2, 0)
    }
  })

  it('maps the deprecated cameraMode onto viewMode', () => {
    const m = byId('start')
    expect(resolveView({ ...m, viewMode: undefined, cameraMode: '3d' })).toBe('parallel')
    expect(resolveView({ ...m, viewMode: 'history', cameraMode: '3d' })).toBe('history')
    expect(resolveView({ ...m, viewMode: undefined, cameraMode: undefined })).toBe('2d')
  })
})
