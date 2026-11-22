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
// dashboard_presence), so a page that goes quiet lets go of the session
// within seconds instead of holding it forever.
//
// Closing the tab must let go at once, though, and a page cannot count on
// getting a last word out while it is being closed: the hosted page reaches
// the monitor on this computer only with the browser's leave, and a request
// made on the way out does not always get it. So while it is in front the
// page also holds one connection to the monitor open (the "watch"). Nothing
// is said over it. When the tab closes, the browser quits or the page goes
// elsewhere, the browser drops that connection, and the monitor resumes the
// session the moment it does.
import { API_BASE, isLocal } from './dataSource'

const BEAT_MS = 5000
// How long to leave an older monitor alone after it turned the watch down.
const NO_WATCH_MS = 5 * 60 * 1000
// This page's name. The monitor remembers which page is in front, so one
// dashboard tab going away does not resume a session another one is holding.
const CLIENT = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^a-z0-9-]/gi, '')
// Fired on window after every answer from the monitor, so the session box
// can redraw at once instead of waiting for its next poll.
export const PRESENCE_EVENT = 'cft:presence'

const inFront = () => document.visibilityState === 'visible' && document.hasFocus()

// What this page last told the monitor. A page that was never in front says
// nothing at all: another dashboard tab may be the one in front, and a
// "not in front" from here would end the pause that tab is holding.
let said = false

// The open connection the monitor watches while this page is in front.
let watch = null
let noWatchUntil = 0

async function openWatch() {
  if (watch || Date.now() < noWatchUntil) return
  const ctl = new AbortController()
  watch = ctl
  try {
    const r = await fetch(`${API_BASE}/api/dashboard/presence/watch?client=${CLIENT}`, {
      signal: ctl.signal,
      cache: 'no-store',
    })
    if (!r.ok || !r.body) {
      // A monitor from before the watch existed: the lease alone, then.
      noWatchUntil = Date.now() + NO_WATCH_MS
      return
    }
    const reader = r.body.getReader()
    while (!(await reader.read()).done) { /* held open; nothing to hear */ }
  } catch {
    // Closed on purpose (no longer in front), or the monitor went away. The
    // next beat opens it again if the page is still in front.
  } finally {
    if (watch === ctl) watch = null
  }
}

function closeWatch() {
  if (watch) watch.abort()
  watch = null
}

async function send(front, keepalive = false) {
  said = front
  if (front) openWatch()
  else closeWatch()
  try {
    const r = await fetch(`${API_BASE}/api/dashboard/presence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ front, client: CLIENT }),
      // Every "not in front" is allowed to outlive the page: it may be the
      // tab closing, where the page is gone before the request has left.
      keepalive: keepalive || !front,
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
