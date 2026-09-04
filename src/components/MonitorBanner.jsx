import { useEffect, useState } from 'react'
import { useMonitorLive } from '../hooks/useMonitorLive'
import { probeMonitor } from '../lib/dataSource'

// cft:// is registered by the exe on Windows only; anywhere else the button
// would resolve to nothing, so those viewers get the self-heal note instead.
const onWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

// One banner instead of a failed card per panel: the page keeps working from
// the cloud mirror, and the button is a plain link to cft://start — the
// browser asks "Open CFT Monitor?" and launches the exe.
export default function MonitorBanner() {
  const live = useMonitorLive()
  const [starting, setStarting] = useState(false)

  // After a protocol launch, poll fast until the monitor answers; give up on
  // the "starting" state after a while so the button comes back.
  useEffect(() => {
    if (!starting) return
    const id = setInterval(probeMonitor, 2000)
    const stop = setTimeout(() => setStarting(false), 45000)
    return () => { clearInterval(id); clearTimeout(stop) }
  }, [starting])
  useEffect(() => { if (live) setStarting(false) }, [live])

  if (live !== false) return null
  return (
    <div
      role="status"
      className="mb-6 flex items-center gap-3 flex-wrap rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <span className={`inline-block w-2 h-2 rounded-full bg-amber-500 ${starting ? 'animate-pulse' : ''}`} />
      <span className="grow">
        <span className="font-semibold">CFT isn't running on this PC.</span>{' '}
        {starting
          ? 'Starting… waiting for it to answer.'
          : "Showing data as of the last sync; session controls and edits resume when it's back."}
      </span>
      {onWindows && !starting && (
        <a
          href="cft://start"
          onClick={() => setStarting(true)}
          className="rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700 transition-colors"
        >
          Start CFT
        </a>
      )}
      {!onWindows && (
        <span className="text-amber-700 dark:text-amber-300">
          It restarts on its own within 10 minutes once that PC is unlocked.
        </span>
      )}
    </div>
  )
}
