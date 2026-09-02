import { useCallback, useEffect, useState } from 'react'
import {
  disconnectBeeminder,
  fetchBeeminder,
  goLiveBeeminder,
  isLocal,
  saveBeeminder,
} from '../lib/dataSource'

// Beeminder setup and health, in one card.
//
//   unconfigured  -> the setup form: connect an existing goal, or have the
//                    monitor create a Do More goal (units: hours) on the
//                    user's own account
//   dry run       -> a notice that nothing is being sent yet, with "Go live"
//   failing       -> the last push's error (deleted goal, dead token...) with
//                    "Reconnect", which reopens the form
//   healthy       -> nothing at all
//
// A Beeminder problem never stops the monitor, so this card is the only
// place it becomes visible outside cft.log. "Not now" hides the setup form
// for people who never want it, without writing anything to the monitor;
// it does not hide a dry-run or failure notice.
const DISMISS_KEY = 'beeminder-card-dismissed'
const POLL_MS = 30000

const inputClass =
  'w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1.5 ' +
  'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ' +
  'placeholder:text-slate-300 dark:placeholder:text-slate-600 transition-colors'

const linkClass = 'underline hover:text-slate-700 dark:hover:text-slate-200'

const primaryBtn =
  'text-xs px-3 py-1.5 rounded-md bg-emerald-500 text-white font-medium hover:bg-emerald-600 ' +
  'disabled:opacity-30 disabled:hover:bg-emerald-500 transition-colors'
const quietBtn =
  'text-xs px-2 py-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 ' +
  'dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors'

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
        {label}
      </span>
      {children}
    </label>
  )
}

function ModePick({ mode, setMode, disabled }) {
  const options = [
    { id: 'create', label: 'Create a goal for me' },
    { id: 'existing', label: 'I already have a goal' },
  ]
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 w-fit" role="group" aria-label="Setup mode">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => setMode(o.id)}
          disabled={disabled}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            mode === o.id
              ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function goalUrl(user, goal) {
  return `https://www.beeminder.com/${encodeURIComponent(user || '')}/${encodeURIComponent(goal || '')}`
}

export default function BeeminderCard() {
  const [status, setStatus] = useState(null)   // last /api/beeminder answer
  const [view, setView] = useState('auto')     // auto | form | done
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('create')
  const [user, setUser] = useState('')
  const [token, setToken] = useState('')
  const [focusGoal, setFocusGoal] = useState('focus')
  const [hoursPerDay, setHoursPerDay] = useState('2')
  const [leewayDays, setLeewayDays] = useState('3')
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1'
  )

  const refresh = useCallback(() => {
    if (!isLocal) return Promise.resolve()
    // An unreachable monitor or an older exe without the endpoint leaves
    // status null, which renders nothing.
    return fetchBeeminder().then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isLocal) return
    let alive = true
    const load = () => refresh().then(() => { if (!alive) setStatus(null) })
    load()
    const id = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [refresh])

  // Prefill the reconnect form with what the monitor already knows.
  useEffect(() => {
    if (status?.user) setUser(status.user)
    if (status?.focus_goal) setFocusGoal(status.focus_goal)
  }, [status?.user, status?.focus_goal])

  if (!isLocal || !status) return null

  const configured = status.configured === true
  const failing = configured && status.last_push && status.last_push.ok === false
  const dryRun = configured && status.dry_run

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  const run = async (fn, after) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
      await refresh()
      if (after) after()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  const creating = mode === 'create'
  const submit = (e) => {
    e.preventDefault()
    run(
      () =>
        saveBeeminder({
          user,
          token,
          focusGoal,
          createGoal: creating,
          hoursPerDay: creating ? hoursPerDay : undefined,
          leewayDays: creating ? leewayDays : undefined,
        }),
      () => { setToken(''); setView('done') }
    )
  }

  const disconnect = () => run(disconnectBeeminder, () => setView('auto'))
  const goLive = () => run(goLiveBeeminder)

  if (view === 'done') {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-4 mb-6 text-sm text-emerald-700 dark:text-emerald-300">
        Beeminder connected — your focus hours now sync every few minutes.{' '}
        <a href={goalUrl(user, focusGoal)} target="_blank" rel="noreferrer" className="underline">
          View the goal
        </a>
        .
      </div>
    )
  }

  // --- configured: only speak up when something needs attention ----------

  if (configured && view !== 'form') {
    if (failing) {
      return (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-4 mb-6">
          <div className="text-sm font-semibold text-red-700 dark:text-red-300">
            Beeminder isn't receiving your hours
          </div>
          <p className="text-xs text-red-600/90 dark:text-red-300/80 mt-0.5 max-w-prose">
            {status.last_push.error}
          </p>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <button onClick={() => { setError(null); setView('form') }} disabled={busy} className={primaryBtn}>
              Reconnect
            </button>
            <button onClick={disconnect} disabled={busy} className={quietBtn}>
              Disconnect
            </button>
            {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
          </div>
        </div>
      )
    }
    if (dryRun) {
      return (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4 mb-6">
          <div className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Beeminder is in dry-run mode — nothing is being sent yet
          </div>
          <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5 max-w-prose">
            Connected to{' '}
            <a href={goalUrl(status.user, status.focus_goal)} target="_blank" rel="noreferrer" className="underline">
              {status.user}/{status.focus_goal}
            </a>
            , but each push is only logged. Go live when the numbers in the log look right.
          </p>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <button onClick={goLive} disabled={busy} className={primaryBtn}>
              {busy ? 'Switching…' : 'Go live'}
            </button>
            <button onClick={disconnect} disabled={busy} className={quietBtn}>
              Disconnect
            </button>
            {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
          </div>
        </div>
      )
    }
    return null
  }

  // --- unconfigured (or reconnecting): the setup form ---------------------

  if (!configured && dismissed) return null

  const incomplete =
    !user.trim() || !token.trim() || !focusGoal.trim() || (creating && !hoursPerDay.trim())

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 mb-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {configured ? 'Reconnect Beeminder' : 'Connect Beeminder'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-prose">
            Push your daily focus hours to a{' '}
            <a href="https://www.beeminder.com" target="_blank" rel="noreferrer" className={linkClass}>
              Beeminder
            </a>{' '}
            goal that charges you when you slack. You need your own Beeminder
            account; grab your token from{' '}
            <a
              href="https://www.beeminder.com/api/v1/auth_token.json"
              target="_blank"
              rel="noreferrer"
              className={linkClass}
            >
              beeminder.com/api/v1/auth_token.json
            </a>
            .
          </p>
        </div>
        {configured ? (
          <button onClick={() => setView('auto')} disabled={busy} className={`shrink-0 ${quietBtn}`}>
            Cancel
          </button>
        ) : (
          <button onClick={dismiss} disabled={busy} className={`shrink-0 ${quietBtn}`}>
            Not now
          </button>
        )}
      </div>

      <div className="mb-3">
        <ModePick mode={mode} setMode={setMode} disabled={busy} />
      </div>

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
        <Field label="Beeminder username">
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            disabled={busy}
            placeholder="alice"
            autoComplete="off"
            className={inputClass}
          />
        </Field>
        <Field label="Auth token">
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={busy}
            type="password"
            placeholder="from the link above"
            autoComplete="off"
            className={inputClass}
          />
        </Field>
        <Field label={creating ? 'New goal name' : 'Existing goal slug (hours)'}>
          <input
            value={focusGoal}
            onChange={(e) => setFocusGoal(e.target.value)}
            disabled={busy}
            placeholder="focus"
            autoComplete="off"
            className={inputClass}
          />
        </Field>
        {creating && (
          <>
            <Field label="Hours per day to commit">
              <input
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(e.target.value)}
                disabled={busy}
                type="number"
                min="0.25"
                max="24"
                step="0.25"
                autoComplete="off"
                className={inputClass}
              />
            </Field>
            <Field label="Days of leeway to start">
              <input
                value={leewayDays}
                onChange={(e) => setLeewayDays(e.target.value)}
                disabled={busy}
                type="number"
                min="0"
                max="30"
                step="1"
                autoComplete="off"
                className={inputClass}
              />
            </Field>
          </>
        )}

        <div className="sm:col-span-4 flex items-center gap-3 flex-wrap">
          <button type="submit" disabled={busy || incomplete} className={primaryBtn}>
            {busy
              ? 'Checking with Beeminder…'
              : creating
                ? 'Create goal & connect'
                : 'Connect'}
          </button>
          {creating && !busy && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Makes a Do More goal (units: hours) on your account. Leeway is
              safety buffer: days you could do nothing before a derail. Start
              easy — you can raise the rate on beeminder.com later.
            </span>
          )}
          {error && (
            <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
          )}
        </div>
      </form>
    </div>
  )
}
