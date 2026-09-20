import { useEffect, useState } from 'react'
import { API_BASE, isMonitorLive, markMonitor, onMonitorLive, probeMonitor } from '../lib/dataSource'

// While the monitor is answering, an idle probe every 15s is plenty (the data
// hooks already report every fetch). While it is NOT, probe every 2s: the
// monitor's own startup waits a few seconds for an existing tab to announce
// itself before opening a new one (monitor/browser.py, grace_sec), and a tab
// that only checks in every 15s would miss that window and get a twin. A
// failed probe is a refused connection — instant and free — so the fast
// cadence costs nothing while it lasts.
const LIVE_MS = 15000
const DOWN_MS = 2000

// The fast probe runs in a dedicated worker, not on the page's own timers.
// A tab that has been in the background for a few minutes has its timers
// throttled to about one wake-up a minute (Chrome's intensive throttling,
// Edge's sleeping tabs), and that is exactly the tab the monitor is asking
// about: the dashboard parked behind whatever the user is working in. Its
// setInterval(2000) would fire once a minute, miss the monitor's window and
// get it a twin. Worker timers are exempt from that throttling.
const WORKER_SRC = `
  let url = null, timer = null
  async function probe() {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 4000)
    let ok = false
    try { ok = (await fetch(url, { signal: ctl.signal, cache: 'no-store' })).ok } catch { ok = false }
    clearTimeout(t)
    postMessage(ok)
  }
  onmessage = (e) => {
    url = e.data.url
    clearInterval(timer)
    probe()
    timer = setInterval(probe, e.data.everyMs)
  }
`

function startDownProbe(onResult) {
  const url = new URL(`${API_BASE}/api/status`, window.location.href).href
  let worker = null
  try {
    const blob = new Blob([WORKER_SRC], { type: 'text/javascript' })
    const src = URL.createObjectURL(blob)
    worker = new Worker(src)
    URL.revokeObjectURL(src)
    worker.onmessage = (e) => onResult(e.data)
    worker.onerror = () => {}
    worker.postMessage({ url, everyMs: DOWN_MS })
    return () => worker.terminate()
  } catch {
    // No worker (an old browser, a CSP that forbids blob: workers): the
    // page's own timer, throttled or not, is still better than nothing.
    probeMonitor()
    const id = setInterval(probeMonitor, DOWN_MS)
    return () => clearInterval(id)
  }
}

// Whether the monitor on this PC is answering: null until the first probe,
// then true/false. Every data call updates it too, so the banner reacts the
// moment a fetch fails or succeeds, not only on the poll.
export function useMonitorLive(pollMs = LIVE_MS) {
  const [live, setLive] = useState(isMonitorLive())
  useEffect(() => {
    const off = onMonitorLive(setLive)
    if (live === true) {
      const id = setInterval(probeMonitor, pollMs)
      return () => { off(); clearInterval(id) }
    }
    const stop = startDownProbe(markMonitor)
    return () => { off(); stop() }
  }, [pollMs, live])
  return live
}
