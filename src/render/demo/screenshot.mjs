// Takes renderer screenshots with Playwright.
// Usage: npx vite --port 5174 &   then   node src/render/demo/screenshot.mjs [outDir] [shot ...]
// Each shot: fixture[:flip][:history|parallel][:3d][@WxH][#focus=l,t][%zoom]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const out = process.argv[2] ?? 'render-shots'
const shots = process.argv.slice(3)
const list = shots.length ? shots : ['branch', 'multi', 'start', 'queen-branch', 'checks', 'checks:flip', 'multi:history', 'multi:parallel', 'multi:3d', 'fairy', 'perf']
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
for (const spec of list) {
  const [main, size = '1920x1080'] = spec.split('@')
  const [id, ...flags] = main.split(':')
  const [w, h] = size.split('x').map(Number)
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.stack ?? e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto(`http://localhost:5174/render-demo.html?shot=1&fixture=${id}`)
  await page.waitForFunction(() => !!window.__demo, null, { timeout: 15000 }).catch(() => {
    throw new Error('demo did not start: ' + errors.join(' | '))
  })
  await page.evaluate(
    ([id, flags]) =>
      window.__demo.setFixture(id, {
        flip: flags.includes('flip'),
        filter: flags.includes('history') ? 'history' : flags.includes('parallel') ? 'parallel' : 'all',
        view: flags.includes('3d') ? 'parallel' : '2d',
        anim: false,
      }),
    [id, flags],
  )
  for (const f of flags) {
    if (f.startsWith('cam=')) {
      const [cx, cy, z] = f.slice(4).split(',').map(Number)
      await page.evaluate(([cx, cy, z]) => window.__demo.renderer.setCamera(cx, cy, z), [cx, cy, z])
    }
    if (f.startsWith('focus=')) {
      const [l, t] = f.slice(6).split(',').map(Number)
      await page.evaluate(([l, t]) => window.__demo.focusBoard(l, t), [l, t])
    }
  }
  await page.waitForTimeout(400)
  await page.waitForFunction(() => !window.__demo.renderer.busy, null, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(200)
  const file = `${out}/${spec.replace(/[:@#%=,]/g, '_')}.png`
  await page.screenshot({ path: file })
  console.log(file, errors.length ? 'ERRORS: ' + errors.join(' | ') : '')
  await page.close()
}
await browser.close()
