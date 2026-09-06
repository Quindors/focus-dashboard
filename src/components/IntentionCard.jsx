import { useCallback, useEffect, useRef, useState } from 'react'
import {
  endBreak,
  endIntention,
  fetchCategories,
  fetchStatus,
  isLocal,
  pauseIntention,
  startBreak,
  startIntention,
} from '../lib/dataSource'

// Mirrors the monitor's own validation (monitor/intentions.py). A focus
// session is a real block of work, so half an hour is the floor.
const MIN_MINUTES = 30
const MAX_MINUTES = 480
const DURATIONS = [30, 45, 60, 90, 120]
const DEFAULT_DURATION = 45
const CUSTOM = 'custom'
const BREAK_MINUTES = 15

// The category picked for an intention is remembered by its text, so typing
// "piq 1" again pre-selects College Application. Per browser, best-effort.
const MEMORY_KEY = 'cft.categoryByIntention'
const normText = (t) => t.trim().toLowerCase().replace(/\s+/g, ' ')
function rememberedCategory(text) {
  try {
    const map = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}')
    return map[normText(text)] || ''
  } catch { return '' }
}
function rememberCategory(text, category) {
  try {
    const map = JSON.parse(localStorage.getItem(MEMORY_KEY) || '{}')
    map[normText(text)] = category
    localStorage.setItem(MEMORY_KEY, JSON.stringify(map))
  } catch { /* no storage: nothing to remember with */ }
}

// Color per state string from monitor/status.py — the same states the desktop
// timer widget and the tray icon key off.
const STATE = {
  on:       { ring: 'text-emerald-500', chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', label: 'On intention' },
  session:  { ring: 'text-emerald-500', chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', label: 'Session running' },
  partial:  { ring: 'text-amber-500',   chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',       label: 'Drifting' },
  off:      { ring: 'text-red-500',     chip: 'bg-red-500/15 text-red-600 dark:text-red-400',             label: 'Off intention' },
  break:    { ring: 'text-sky-500',     chip: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',             label: 'On a break' },
  paused:   { ring: 'text-sky-500',     chip: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',             label: 'Paused' },
  idle:     { ring: 'text-slate-400',   chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400',       label: 'No session' },
}

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

function formatLeft(secs) {
  const s = Math.max(0, Math.round(secs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

// Countdown ring. Ticks locally every second so it stays smooth between the
// polls, rather than jumping in 5-second steps. `verb` names what happens at
// zero — a session "ends", a pause "resumes".
function Dial({ snap, colors, verb = 'ends' }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const started = parseStamp(snap.started_at)
  const ends = parseStamp(snap.ends_at)
  if (!ends) return null

  const left = Math.max(0, (ends - Date.now()) / 1000)
  const span = started ? (ends - started) / 1000 : 0
  const used = span > 0 ? Math.min(1, Math.max(0, 1 - left / span)) : 0
  const r = 34
  const circ = 2 * Math.PI * r

  return (
    <div className="flex items-center gap-4">
      <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90 flex-none">
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="6"
                className="stroke-slate-200 dark:stroke-slate-800" />
        <circle cx="42" cy="42" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
                className={`${colors.ring} transition-[stroke-dashoffset] duration-1000 ease-linear`}
                stroke="currentColor" strokeDasharray={circ}
                strokeDashoffset={circ * (1 - used)} />
      </svg>
      <div>
        <div className="text-3xl font-bold leading-none tabular-nums text-slate-800 dark:text-slate-100">
          {formatLeft(left)}
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
          left · {verb} {timeLabel(ends)}
        </div>
      </div>
    </div>
  )
}

function Chip({ colors }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${colors.chip}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {colors.label}
    </span>
  )
}

// Focus sessions and breaks — the two halves of the same cycle, so they share
// one card. A session is what you declare and get scored against (ALIGN); a
// break is the monitor switching off entirely for 15 minutes afterwards.
// Both live on the monitor's machine, so this renders in local mode only and
// stays hidden until the API answers.
export default function IntentionCard() {
  const [snap, setSnap] = useState(null)
  const [ready, setReady] = useState(false)
  const [text, setText] = useState('')
  // duration is a number of minutes, or CUSTOM while the custom field is open.
  const [duration, setDuration] = useState(DEFAULT_DURATION)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // The category is the user's call: '' lets the gate decide, anything else
  // is validated by the monitor and only double-checked by the gate.
  const [category, setCategory] = useState('')
  const [cats, setCats] = useState([])
  const [pending, setPending] = useState(null)   // a 409 from the gate: {picked, suggested, reason}
  const alive = useRef(true)

  const refresh = useCallback(() => {
    if (!isLocal) return
    fetchStatus()
      .then((s) => { if (alive.current) { setSnap(s); setReady(true) } })
      .catch(() => {}) // monitor unreachable — keep the last known state
  }, [])

  useEffect(() => {
    alive.current = true
    refresh()
    // keep in sync with the tray, the timer widget, other tabs and expiry
    const id = setInterval(refresh, 5000)
    return () => { alive.current = false; clearInterval(id) }
  }, [refresh])

  useEffect(() => {
    if (!isLocal) return
    fetchCategories()
      .then((c) => { if (alive.current) setCats(c.filter((x) => x.is_productive !== false)) })
      .catch(() => {})
  }, [])

  if (!isLocal || !ready || !snap) return null

  const colors = STATE[snap.state] || STATE.idle

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

  const minutes = duration === CUSTOM ? Number(custom) : duration
  const minutesValid =
    Number.isInteger(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES
  const canStart = !busy && text.trim() !== '' && minutesValid

  const onTextChange = (v) => {
    setText(v)
    setPending(null)
    const remembered = rememberedCategory(v)
    if (remembered) setCategory(remembered)
  }
  const launch = async (cat, confirm = false) => {
    await startIntention(text, minutes, cat || undefined, confirm)
    if (cat) rememberCategory(text, cat)
    setText('')
    setPending(null)
  }
  const start = () => run(async () => {
    try {
      await launch(category)
    } catch (e) {
      // The gate disagreed with the pick: not an error, a question.
      if (e.data?.needs_confirm) { setPending(e.data); return }
      throw e
    }
  })
  const keepPick = () => run(() => launch(pending.picked, true))
  const usePick = (cat) => run(async () => { setCategory(cat); await launch(cat) })
  const finish = (status) => run(() => endIntention(status))
  const takeBreak = () => run(() => startBreak(BREAK_MINUTES))
  const stopBreak = () => run(() => endBreak())
  const pause = () => run(() => pauseIntention())
  // A pause is a break under the hood, so resuming early is ending the
  // break — the monitor hands the unused part of the minute back.
  const resume = () => run(() => endBreak())

  const card = 'mb-6 bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors'

  if (snap.phase === 'break') {
    return (
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Break
          </h2>
          <Chip colors={colors} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-6">
          <Dial snap={snap} colors={colors} />
          <p className="flex-1 min-w-[240px] text-sm text-slate-500 dark:text-slate-400">
            Tracking and alerts are both switched off. Nothing you do right now is
            classified or logged, and there's no intention to set — the monitor
            turns itself back on when the timer runs out.
          </p>
          <button
            onClick={stopBreak}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            End break now
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    )
  }

  if (snap.phase === 'session') {
    const paused = snap.state === 'paused'
    // While paused, snap's started_at/ends_at window is the pause itself, so
    // the Dial counts down to the resume. The session's own frozen remainder
    // is how far its (extended) end sits past the pause's end.
    const sessionEnd = paused && snap.intention ? parseStamp(snap.intention.ends_at) : null
    const pauseEnd = paused && snap.break ? parseStamp(snap.break.ends_at) : null
    const frozenLeft = sessionEnd && pauseEnd ? Math.max(0, (sessionEnd - pauseEnd) / 1000) : null
    return (
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            Focus session
          </h2>
          <Chip colors={colors} />
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex-[2] min-w-[220px]">
            <div className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              {snap.label}
            </div>
            {/* No live category here: reading it makes the dashboard the
                foreground window, so it only ever reported the dashboard's
                own classification. The timer widget shows the same field and
                floats over real work, where it means something. */}
            <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              {paused
                ? `timer frozen${frozenLeft != null ? ` — resumes with ${formatLeft(frozenLeft)} left` : ''}`
                : `started ${timeLabel(parseStamp(snap.started_at))}`}
            </div>
          </div>
          <Dial snap={snap} colors={colors} verb={paused ? 'resumes' : 'ends'} />
          <div className="flex gap-2">
            {paused ? (
              <button
                onClick={resume}
                disabled={busy}
                title="Resume the session now — the unused pause time is handed back"
                className="px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              >
                Resume now
              </button>
            ) : (
              <>
                <button
                  onClick={() => finish('completed')}
                  disabled={busy}
                  title={`Ends the session and starts a ${BREAK_MINUTES}-minute break`}
                  className="px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
                >
                  Done
                </button>
                <button
                  onClick={pause}
                  disabled={busy}
                  title="Freeze the timer and monitoring for 1 minute — no session time is lost"
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  Pause 1m
                </button>
              </>
            )}
            <button
              onClick={() => finish('abandoned')}
              disabled={busy}
              title="Ends the session without a break"
              className="px-3 py-1.5 rounded-md text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              Abandon
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    )
  }

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          Focus session
        </h2>
        <Chip colors={colors} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canStart) start() }}
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
          <button
            onClick={() => setDuration(CUSTOM)}
            title={`Custom length (${MIN_MINUTES}-${MAX_MINUTES} minutes)`}
            className={`px-2.5 py-1 rounded-md text-sm font-medium transition-colors ${
              duration === CUSTOM
                ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            Custom
          </button>
        </div>
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPending(null) }}
          aria-label="Session category"
          className="rounded-md border border-slate-300 dark:border-slate-700 bg-transparent px-2 py-1.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          <option value="">Category: let the gate decide</option>
          {cats.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        {duration === CUSTOM && (
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canStart) start() }}
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              autoFocus
              aria-label="Custom session length in minutes"
              placeholder="180"
              className={`w-20 rounded-md border bg-transparent px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 ${
                custom !== '' && !minutesValid
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-slate-300 dark:border-slate-700 focus:ring-emerald-500'
              }`}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">min</span>
          </div>
        )}
        <button
          onClick={start}
          disabled={!canStart}
          title={
            duration === CUSTOM && !minutesValid
              ? `Enter ${MIN_MINUTES}-${MAX_MINUTES} minutes`
              : undefined
          }
          className="px-4 py-1.5 rounded-md text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
        >
          Start
        </button>
      </div>

      {pending && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          <span className="grow">
            The gate reads this as <b>{pending.suggested}</b>, not {pending.picked}
            {pending.reason ? ` — ${pending.reason}` : ''}. Your call.
          </span>
          <button onClick={() => usePick(pending.suggested)} disabled={busy} className="rounded-md bg-amber-600 px-2.5 py-1 text-white hover:bg-amber-700 disabled:opacity-50">
            Use {pending.suggested}
          </button>
          <button onClick={keepPick} disabled={busy} className="rounded-md border border-amber-400 px-2.5 py-1 hover:bg-amber-100 dark:hover:bg-amber-500/20 disabled:opacity-50">
            Keep {pending.picked}
          </button>
        </div>
      )}

      <button
        onClick={takeBreak}
        disabled={busy}
        className="mt-3 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 underline underline-offset-4 disabled:opacity-50 transition-colors"
      >
        or take a {BREAK_MINUTES}-minute break now
      </button>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
