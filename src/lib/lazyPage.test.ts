import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { isMissingCode, loadPage, type Reloader } from './lazyPage'

// What Chrome said when the host pressed Recap in a control room opened before a
// deploy: the old app asked for the recap page's old file, which the deploy removed.
const GONE = new TypeError('Failed to fetch dynamically imported module: https://hurra.example/assets/Recap-CMO_fSsT.js')
const RECAP = '/host/s/e3e24b7f-9c1a-4f32-9eb6-1371cc7753ca/recap'

function fakeReloader({ answers = true, reloads = true } = {}) {
  return { siteAnswers: vi.fn(async () => answers), reload: vi.fn<Reloader['reload']>(() => reloads) } satisfies Reloader
}

/** Whether the promise has settled once everything already queued has run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false
  promise.then(
    () => (done = true),
    () => (done = true),
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  return done
}

describe('a page loaded on demand', () => {
  it('loads the new deploy at the recap when its old file is gone, and never shows the error', async () => {
    const reloader = fakeReloader()
    const page = loadPage(() => Promise.reject(GONE), () => RECAP, reloader)
    // Still pending: the route keeps the loader up until the new app takes over.
    expect(await settled(page)).toBe(false)
    expect(reloader.reload).toHaveBeenCalledTimes(1)
    expect(reloader.reload).toHaveBeenCalledWith(RECAP)
  })

  it('reloads this address when no navigation is under way (the page was opened directly)', async () => {
    const reloader = fakeReloader()
    expect(await settled(loadPage(() => Promise.reject(GONE), undefined, reloader))).toBe(false)
    expect(reloader.reload).toHaveBeenCalledWith(null)
  })

  it('knows what Chrome, Firefox and Safari say for a module that did not load, and Vite for its CSS', () => {
    expect(isMissingCode(GONE)).toBe(true)
    expect(isMissingCode(new TypeError('error loading dynamically imported module: https://hurra.example/assets/Recap-x.js'))).toBe(true)
    expect(isMissingCode(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isMissingCode(new Error('Unable to preload CSS for /assets/Recap-x.css'))).toBe(true)
    expect(isMissingCode(new TypeError("Cannot read properties of undefined (reading 'default')"))).toBe(false)
  })

  it('shows the error when the site does not answer: a reload would only lose the page', async () => {
    const reloader = fakeReloader({ answers: false })
    await expect(loadPage(() => Promise.reject(GONE), () => RECAP, reloader)).rejects.toBe(GONE)
    expect(reloader.reload).not.toHaveBeenCalled()
  })

  it('shows the error when it just reloaded for new code, so a broken deploy never loops', async () => {
    const reloader = fakeReloader({ reloads: false })
    await expect(loadPage(() => Promise.reject(GONE), () => RECAP, reloader)).rejects.toBe(GONE)
  })

  it('leaves other errors alone, and passes a page that loads', async () => {
    const reloader = fakeReloader()
    const broken = new Error('boom')
    await expect(loadPage(() => Promise.reject(broken), () => RECAP, reloader)).rejects.toBe(broken)
    expect(reloader.siteAnswers).not.toHaveBeenCalled()
    const module = { default: 'the page' }
    await expect(loadPage(async () => module, () => RECAP, reloader)).resolves.toBe(module)
  })

  it('is how the router loads every page it loads on demand, the recap included', () => {
    const router = readFileSync(new URL('../router.tsx', import.meta.url), 'utf8')
    const imports = router.match(/import\('@\/pages\/[^']+'\)/g) ?? []
    expect(imports).toContain("import('@/pages/host/Recap')")
    expect(router.match(/lazyPage\(\(\) => import\('@\/pages\/[^']+'\), goingTo\)/g)).toHaveLength(imports.length)
  })
})
