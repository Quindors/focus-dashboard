import { useEffect, useState } from 'react'
import { fetchBeeminder, saveBeeminder, isLocal } from '../lib/dataSource'

// One-time Beeminder setup. Renders only while the integration is
// unconfigured: once the monitor's .env holds a user/token/goal (whether
// saved here or edited by hand), /api/beeminder reports configured and the
// card disappears for good. "Not now" hides it locally for people who never
// want it, without writing anything to the monitor.
//
// Two paths: connect a goal that already exists on beeminder.com, or have
// the monitor create a fresh Do More goal (units: hours) on the user's own
// account — they still need their own Beeminder account and token either way.
const DISMISS_KEY = 'beeminder-card-dismissed'

const inputClass =
  'w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1.5 ' +
  'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ' +
  'placeholder:text-slate-300 dark:placeholder:text-slate-600 transition-colors'

const linkClass = 'underline hover:text-slate-700 dark:hover:text-slate-200'

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

export default function BeeminderCard() {
  const [state, setState] = useState('hidden') // hidden | form | saving | done
  const [mode, setMode] = useState('create')
  const [error, setError] = useState(null)
  const [user, setUser] = useState('')
  const [token, setToken] = useState('')
  const [focusGoal, setFocusGoal] = useState('focus')
  const [hoursPerDay, setHoursPerDay] = useState('2')
  const [leewayDays, setLeewayDays] = useState('3')
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1'
  )

  useEffect(() => {
    if (!isLocal || dismissed) return
    let alive = true
    fetchBeeminder()
      .then((s) => {
        // Only an explicit "not configured" shows the card; an unreachable
        // monitor or an older exe without the endpoint keeps it hidden.
        if (alive && s && s.configured === false) setState('form')
      })
      .catch(() => {})
    return () => { alive = false }
  }, [dismissed])

  if (!isLocal || dismissed || state === 'hidden') return null

  if (state === 'done') {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-4 mb-6 text-sm text-emerald-700 dark:text-emerald-300">
        Beeminder connected — your focus hours now sync every few minutes.{' '}
        <a
          href={`https://www.beeminder.com/${encodeURIComponent(user.trim())}/${encodeURIComponent(focusGoal.trim())}`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          View the goal
        </a>
        .
      </div>
    )
  }

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  const creating = mode === 'create'

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setState('saving')
    try {
      await saveBeeminder({
        user,
        token,
        focusGoal,
        createGoal: creating,
        hoursPerDay: creating ? hoursPerDay : undefined,
        leewayDays: creating ? leewayDays : undefined,
      })
      setState('done')
    } catch (err) {
      setError(err.message)
      setState('form')
    }
  }

  const busy = state === 'saving'
  const incomplete =
    !user.trim() || !token.trim() || !focusGoal.trim() || (creating && !hoursPerDay.trim())

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 mb-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Connect Beeminder
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
        <button
          onClick={dismiss}
          disabled={busy}
          className="shrink-0 text-xs px-2 py-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          Not now
        </button>
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
          <button
            type="submit"
            disabled={busy || incomplete}
            className="text-xs px-3 py-1.5 rounded-md bg-emerald-500 text-white font-medium hover:bg-emerald-600 disabled:opacity-30 disabled:hover:bg-emerald-500 transition-colors"
          >
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
