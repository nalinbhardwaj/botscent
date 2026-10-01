// Raw Chrome DevTools Protocol, the way an extension's debugger or an MCP server
// drives a tab (Playwright keeps every page visible and focused, so it cannot
// make a hidden document). Launches Chromium in new headless mode.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

export type Tab = { targetId: string; session: string; evaluate<T>(expression: string): Promise<T> }
export type Cdp = {
  tab(url: string): Promise<Tab>
  activate(tab: Tab): Promise<void>
  click(tab: Tab, x: number, y: number): Promise<void>
  close(): void
}

export async function launch(): Promise<Cdp> {
  const args = [
    '--headless=new',
    '--disable-blink-features=AutomationControlled',
    '--remote-debugging-port=0',
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'botscent-'))}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]
  const chrome: ChildProcess = spawn(chromium.executablePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
  const url = await new Promise<string>((resolve, reject) => {
    chrome.stderr!.on('data', (d) => {
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(d))
      if (m) resolve(m[1]!)
    })
    chrome.on('exit', () => reject(new Error('chromium exited')))
  })
  const socket = new WebSocket(url)
  await new Promise((resolve) => socket.addEventListener('open', resolve))
  let next = 0
  const pending = new Map<number, (message: { result?: any; error?: { message: string } }) => void>()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++next
      pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  return {
    async tab(url) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank', newWindow: false })
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
      await send('Page.enable', {}, sessionId)
      const loaded = new Promise<void>((resolve) => {
        const onLoad = (event: MessageEvent) => {
          const m = JSON.parse(String(event.data))
          if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') {
            socket.removeEventListener('message', onLoad)
            resolve()
          }
        }
        socket.addEventListener('message', onLoad)
      })
      await send('Page.navigate', { url }, sessionId)
      await loaded
      const evaluate = async <T>(expression: string): Promise<T> =>
        (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result
          .value as T
      return { targetId, session: sessionId, evaluate }
    },
    async activate(tab) {
      await send('Target.activateTarget', { targetId: tab.targetId })
    },
    async click(tab, x, y) {
      for (const type of ['mousePressed', 'mouseReleased'])
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, tab.session)
    },
    close() {
      socket.close()
      chrome.kill()
    },
  }
}
