// Tell the monitor when the dashboard is the window in front.
//
// While it is, the running focus session is paused: looking at the dashboard
// is neither the work nor a drift from it, so the countdown stands still and
// nothing is scored until you go back. The monitor cannot see this from the
// outside reliably (a window title names only a browser's active tab, and it
// stops watching windows altogether during a pause), so the page says it.
//
// "In front" means the tab is the visible one AND its window has the focus.
// The page says so on every change and every few seconds in between: the
// monitor holds the pause on a short lease (monitor/intentions.py,
// dashboard_presence), so a tab that is closed or crashes without a goodbye
// lets go of the session within seconds instead of holding it forever.
import { API_BASE, isLocal } from './dataSource'

const BEAT_MS = 5000
// Fired on window after every answer from the monitor, so the session box
// can redraw at once instead of waiting for its next poll.
export const PRESENCE_EVENT = 'cft:presence'

const inFront = () => document.visibilityState === 'visible' && document.hasFocus()

// What this page last told the monitor. A page that was never in front says
// nothing at all: another dashboard tab may be the one in front, and a
// "not in front" from here would end the pause that tab is holding.
let said = false

async function send(front, keepalive = false) {
  said = front
  try {
    const r = await fetch(`${API_BASE}/api/dashboard/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ front }),
      keepalive,
    })
    const d = await r.json().catch(() => ({}))
    window.dispatchEvent(new CustomEvent(PRESENCE_EVENT, { detail: { front, paused: !!d.paused } }))
  } catch {
    // Monitor unreachable: there is no session to pause either.
  }
}

// Say where the page is right now. Called on every focus/visibility change,
// on the beat, and by the session box right after it starts or resumes a
// session (so a session started here is held from its first second).
export function reportPresence() {
  if (!isLocal) return Promise.resolve()
  const front = inFront()
  if (front) return send(true)
  if (said) return send(false)
  return Promise.resolve()
}

export function watchPresence() {
  if (!isLocal) return () => {}
  const onChange = () => { reportPresence() }
  const onLeave = () => { if (said) send(false, true) }
  window.addEventListener('focus', onChange)
  window.addEventListener('blur', onChange)
  document.addEventListener('visibilitychange', onChange)
  window.addEventListener('pagehide', onLeave)
  const id = setInterval(() => { if (inFront()) send(true) }, BEAT_MS)
  reportPresence()
  return () => {
    clearInterval(id)
    window.removeEventListener('focus', onChange)
    window.removeEventListener('blur', onChange)
    document.removeEventListener('visibilitychange', onChange)
    window.removeEventListener('pagehide', onLeave)
    if (said) send(false, true)
  }
}
