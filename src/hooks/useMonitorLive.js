import { useEffect, useState } from 'react'
import { isMonitorLive, onMonitorLive, probeMonitor } from '../lib/dataSource'

// Whether the monitor on this PC is answering: null until the first probe,
// then true/false. Every data call updates it too, so the banner reacts the
// moment a fetch fails or succeeds, not only on the poll.
export function useMonitorLive(pollMs = 15000) {
  const [live, setLive] = useState(isMonitorLive())
  useEffect(() => {
    const off = onMonitorLive(setLive)
    probeMonitor()
    const id = setInterval(probeMonitor, pollMs)
    return () => { off(); clearInterval(id) }
  }, [pollMs])
  return live
}
