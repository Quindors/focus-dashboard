import { useEffect, useState } from 'react'
import { isMonitorLive, onMonitorLive, probeMonitor } from '../lib/dataSource'

// While the monitor is answering, an idle probe every 15s is plenty (the data
// hooks already report every fetch). While it is NOT, probe every 2s: the
// monitor's own startup waits a few seconds for an existing tab to announce
// itself before opening a new one (monitor/browser.py, grace_sec), and a tab
// that only checks in every 15s would miss that window and get a twin. A
// failed probe is a refused connection — instant and free — so the fast
// cadence costs nothing while it lasts.
const LIVE_MS = 15000
const DOWN_MS = 2000

// Whether the monitor on this PC is answering: null until the first probe,
// then true/false. Every data call updates it too, so the banner reacts the
// moment a fetch fails or succeeds, not only on the poll.
export function useMonitorLive(pollMs = LIVE_MS) {
  const [live, setLive] = useState(isMonitorLive())
  useEffect(() => {
    const off = onMonitorLive(setLive)
    probeMonitor()
    const id = setInterval(probeMonitor, live === true ? pollMs : DOWN_MS)
    return () => { off(); clearInterval(id) }
  }, [pollMs, live])
  return live
}
