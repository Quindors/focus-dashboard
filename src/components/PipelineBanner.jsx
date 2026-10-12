import { useEffect, useState } from 'react'
import { useMonitorLive } from '../hooks/useMonitorLive'
import { fetchStatus, isLocal } from '../lib/dataSource'

// The monitor is running, but a stage of its classify -> log pipeline is
// failing: the AI provider is out of credits, the key was revoked, the disk
// is full. None of those stop the exe — an error verdict is simply not
// written — so without this the day reads as a quiet afternoon and cft.log
// is the only witness. The monitor reports each failing stage in
// /api/status as {stage, message, fix, since, count} (monitor/status.py)
// once it has failed twice in a row, and withdraws it on the next success,
// so a box here means "failing right now", never "failed once at 9am".
//
// One box per problem, in the same voice as the "CFT isn't running" banner:
// what is wrong on the first line, what to do underneath, how long it has
// been going on in the corner.
const POLL_MS = 10000

const STAGE = {
  classifier: 'Classifier',
  vision: 'Screen check',
  storage: 'Saving',
  mirror: 'Cloud copy',
  corrections: 'Corrections',
}

function since(p) {
  if (!p.since) return ''
  const at = new Date(p.since * 1000)
  const when = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const checks = p.count > 1 ? ` · ${p.count} checks lost` : ''
  return `Since ${when}${checks}`
}

export default function PipelineBanner() {
  const live = useMonitorLive()
  const [problems, setProblems] = useState([])

  useEffect(() => {
    // Nothing to ask while the monitor is down — the other banner has that.
    if (!isLocal || live !== true) return undefined
    let alive = true
    const tick = () =>
      fetchStatus()
        .then((s) => { if (alive) setProblems(Array.isArray(s.problems) ? s.problems : []) })
        .catch(() => {})
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [live])

  // Whatever was failing when the monitor went down is unknown now, and
  // the down banner is already on screen; show nothing stale.
  const shown = live === true ? problems : []
  if (!shown.length) return null
  return (
    <div className="mb-6 space-y-3">
      {shown.map((p) => (
        <div
          key={p.stage}
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
        >
          <span className="mt-1.5 inline-block w-2 h-2 shrink-0 rounded-full bg-red-500" />
          <div className="grow min-w-0">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <span>
                <span className="font-semibold">{STAGE[p.stage] || 'Monitor'}:</span>{' '}
                {p.message}
              </span>
              <span className="text-xs text-red-700/80 dark:text-red-300/70 whitespace-nowrap">
                {since(p)}
              </span>
            </div>
            {p.fix && (
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-prose">
                {p.fix}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
