import { useCallback, useEffect, useState } from 'react'
import { endIntention, fetchIntention, isLocal, startIntention } from '../lib/dataSource'

const DURATIONS = [15, 25, 45, 60, 90]
const DEFAULT_DURATION = 45

// Parse the monitor's naive local "YYYY-MM-DD HH:MM:SS" stamps explicitly —
// Date-from-string parsing of that format is implementation-defined.
function parseStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s || '')
  if (!m) return null
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
}

function timeLabel(d) {
  return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
}

function Countdown({ active, onExpired }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const started = parseStamp(active.started_at)
  const ends = parseStamp(active.ends_at)
  if (!started || !ends) return null

  const total = ends - started
  const left = ends - Date.now()
  if (left <= 0) {
    // The server flips past-due sessions to expired on its next read.
    onExpired()
    return null
  }
  const mins = Math.floor(left / 60000)
  const secs = Math.floor((left % 60000) / 1000)
  const pct = Math.min(100, Math.max(0, ((total - left) / total) * 100))

  return (
    <div className="flex-1 min-w-[140px]">
      <div className="text-2xl font-bold leading-none text-emerald-600 dark:text-emerald-400 tabular-nums">
        {mins}:{String(secs).padStart(2, '0')}
      </div>
      <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
        left · ends {timeLabel(ends)}
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// Session intention: declare what you intend to work on; the monitor scores
// every classification against it (ALIGN) and alerts on sustained drift.
// Intentions live on the monitor's machine, so like ModeToggle this renders
// in local mode only and hides until the API answers.
export default function IntentionCard() {
  const [active, setActive] = useState(null)
  const [ready, setReady] = useState(false)
  const [text, setText] = useState('')
  const [duration, setDuration] = useState(DEFAULT_DURATION)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(() => {
    if (!isLocal) return
    fetchIntention()
      .then((a) => { setActive(a); setReady(true) })
      .catch(() => {}) // monitor unreachable — keep the last known state
  }, [])

  useEffect(() => {
    refresh()
    // keep in sync with the tray / other tabs / expiry
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [refresh])

  if (!isLocal || !ready) return null

  const run = async (fn) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      refresh()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const start = () => run(async () => {
    setActive(await startIntention(text, duration))
    setText('')
  })
  const end = (status) => run(async () => {
    await endIntention(status)
    setActive(null)
  })

  return (
    <div className="mb-6 bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
        Focus session
      </h2>

      {active ? (
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex-[2] min-w-[220px]">
            <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">{active.text}</div>
            <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              started {timeLabel(parseStamp(active.started_at))}
            </div>
          </div>
          <Countdown active={active} onExpired={refresh} />
          <div className="flex gap-2">
            <button
              onClick={() => end('completed')}
              disabled={busy}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
            >
              Done
            </button>
            <button
              onClick={() => end('abandoned')}
              disabled={busy}
              className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              Abandon
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') start() }}
            placeholder="What do you intend to work on?"
            maxLength={300}
            className="flex-1 min-w-[220px] rounded-md border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-1.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <div className="flex gap-1 rounded-lg bg-slate-200/70 dark:bg-slate-800 p-1">
            {DURATIONS.map((m) => (
              <button
                key={m}
                onClick={() => setDuration(m)}
                className={`px-2.5 py-1 rounded-md text-sm font-medium transition-colors ${
                  duration === m
                    ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {m}m
              </button>
            ))}
          </div>
          <button
            onClick={start}
            disabled={busy || !text.trim()}
            className="px-4 py-1.5 rounded-md text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
          >
            Start
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
