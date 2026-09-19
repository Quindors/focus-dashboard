import { useCallback, useEffect, useState } from 'react'
import {
  disconnectEmailReport,
  emailReportPreviewUrl,
  fetchEmailReport,
  isLocal,
  saveEmailReport,
  sendEmailReportNow,
} from '../lib/dataSource'
import ErrorNote from './ErrorNote'

// The weekly email report: who it goes to, when, and whether it is landing.
//
//   unconfigured  -> a one-line offer, dismissible; opens the setup form
//   configured    -> a quiet strip naming the recipients and the next send,
//                    with Preview / Send now / Edit
//   failing       -> the same strip in red, carrying the mail server's own
//                    complaint (a rejected app password says so in words)
//
// Everything here is local-API only: the recipients and the SMTP login live
// in the monitor's .env, so a hosted dashboard with no monitor behind it
// renders nothing at all.
//
// The form is one form on purpose. Recipients, server and schedule are
// verified together — the POST logs in to the mail server before a single
// value is written — so there is no half-saved state where the report is
// "set up" but silently cannot send.
const DISMISS_KEY = 'email-report-card-dismissed'
const POLL_MS = 60000

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

// Nobody needs to run a mail server to get this report — they send through
// the account they already have. Picking a provider answers the host, port
// and encryption questions on their behalf, so those three never have to be
// asked; "Something else" is the only case that still has to.
//
// The app-password help is per-provider because "use an app password" is
// useless advice on its own: what makes it actionable is the page it lives on
// and the one prerequisite that trips everyone up.
const PROVIDERS = [
  {
    id: 'gmail',
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: '587',
    security: 'starttls',
    example: 'you@gmail.com',
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    appPasswordSteps: 'Type any name, then copy the 16 characters Google ' +
      'shows you. If that page says it is unavailable, turn on 2-Step ' +
      'Verification first and go back.',
  },
  {
    id: 'outlook',
    label: 'Outlook',
    host: 'smtp-mail.outlook.com',
    port: '587',
    security: 'starttls',
    example: 'you@outlook.com',
    appPasswordUrl: 'https://account.microsoft.com/security',
    appPasswordSteps: 'Under Advanced security options, create a new app ' +
      'password and copy it.',
  },
  {
    id: 'icloud',
    label: 'iCloud',
    host: 'smtp.mail.me.com',
    port: '587',
    security: 'starttls',
    example: 'you@icloud.com',
    appPasswordUrl: 'https://account.apple.com',
    appPasswordSteps: 'Under Sign-In and Security, choose App-Specific ' +
      'Passwords and make one.',
  },
  { id: 'other', label: 'Something else', example: 'you@example.com' },
]

const DAYS = [
  { id: 'mon', label: 'Monday' }, { id: 'tue', label: 'Tuesday' },
  { id: 'wed', label: 'Wednesday' }, { id: 'thu', label: 'Thursday' },
  { id: 'fri', label: 'Friday' }, { id: 'sat', label: 'Saturday' },
  { id: 'sun', label: 'Sunday' },
]

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  id: String(h),
  label: `${String(h).padStart(2, '0')}:00`,
}))

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-[11px] text-slate-400 dark:text-slate-500 mt-1">{hint}</span>
      )}
    </label>
  )
}

function Select({ value, onChange, options, disabled }) {
  return (
    <select value={value} onChange={onChange} disabled={disabled} className={inputClass}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  )
}

// "Monday 09:00" -> the next one, in words a human reads without doing date
// arithmetic. `pending` means the slot already passed with the machine off,
// so the mail is owed rather than scheduled.
function whenLabel(status) {
  if (!status.next_send) return null
  const at = new Date(status.next_send.replace(' ', 'T'))
  if (Number.isNaN(at.getTime())) return null
  const stamp = at.toLocaleString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return status.pending ? `due now (${stamp} was missed)` : stamp
}

function recipientLabel(recipients) {
  if (!recipients || recipients.length === 0) return 'nobody'
  if (recipients.length === 1) return recipients[0]
  return `${recipients[0]} and ${recipients.length - 1} other${recipients.length > 2 ? 's' : ''}`
}

export default function EmailReportCard() {
  const [status, setStatus] = useState(null)
  const [view, setView] = useState('auto')     // auto | form | done
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)       // a one-off "sent" confirmation
  const [error, setError] = useState(null)
  const [provider, setProvider] = useState('gmail')
  const [to, setTo] = useState('')
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com')
  const [smtpPort, setSmtpPort] = useState('587')
  const [security, setSecurity] = useState('starttls')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [sender, setSender] = useState('')
  const [day, setDay] = useState('mon')
  const [hour, setHour] = useState('9')
  const [sendTest, setSendTest] = useState(true)
  // Who, if anyone, was just sent a one-off introduction. Worth saying out
  // loud: an email went to someone else on the user's behalf.
  const [introduced, setIntroduced] = useState([])
  // Server settings are hidden unless the provider is unknown or the stored
  // setup is unusual. Three fields nobody can answer from memory, sitting in
  // plain sight, read as three questions you have failed rather than three
  // answers already filled in.
  const [advanced, setAdvanced] = useState(false)
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1'
  )

  const refresh = useCallback(() => {
    if (!isLocal) return Promise.resolve()
    // An unreachable monitor, or an exe older than this endpoint, leaves
    // status null — which renders nothing rather than an error.
    return fetchEmailReport().then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isLocal) return
    let alive = true
    const load = () => refresh().then(() => { if (!alive) setStatus(null) })
    load()
    const id = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [refresh])

  // Prefilling happens when the form is opened, not in an effect: the status
  // refreshes every minute, and seeding from it on each poll would rewrite
  // the recipient list under the cursor of whoever is editing it. The
  // password never comes back from the monitor, so it stays blank — which
  // the save endpoint reads as "keep the stored one".
  const openForm = () => {
    if (status?.configured) {
      setTo((status.recipients || []).join(', '))
      if (status.smtp_host) setSmtpHost(status.smtp_host)
      if (status.smtp_port) setSmtpPort(String(status.smtp_port))
      if (status.smtp_user) setSmtpUser(status.smtp_user)
      if (status.sender) setSender(status.sender)
      if (status.security) setSecurity(status.security)
      if (status.day) setDay(status.day)
      if (status.hour !== undefined && status.hour !== null) setHour(String(status.hour))
      const known = PROVIDERS.find((p) => p.host === status.smtp_host)
      setProvider(known ? known.id : 'other')
      // Open the server settings for a setup the simple form cannot express:
      // an unknown provider, or a From address that isn't the login.
      setAdvanced(!known || (!!status.sender && status.sender !== status.smtp_user))
    }
    setSmtpPassword('')
    setError(null)
    setView('form')
  }

  if (!isLocal || !status) return null

  const configured = status.configured === true
  const problem = configured ? status.problem : null

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  const run = async (fn, after) => {
    setError(null)
    setNote(null)
    setBusy(true)
    try {
      const result = await fn()
      // The send endpoints answer 200 with the fresh status even when the
      // mail server refused, so the refusal is in the body, not an exception.
      if (result && result.problem) setError(result.problem)
      await refresh()
      if (after && !(result && result.problem)) after(result)
    } catch (err) {
      setError(err)
    }
    setBusy(false)
  }

  const pickProvider = (id) => {
    setProvider(id)
    const preset = PROVIDERS.find((p) => p.id === id)
    if (preset?.host) {
      setSmtpHost(preset.host)
      setSmtpPort(preset.port)
      setSecurity(preset.security)
    }
  }

  // In the simple form one field answers two questions, because for every
  // provider here the address you send from IS the address you sign in with.
  const setAccount = (value) => {
    setSmtpUser(value)
    setSender(value)
  }

  const submit = (e) => {
    e.preventDefault()
    run(
      () => saveEmailReport({
        to, smtpHost, smtpPort, smtpUser, smtpPassword, sender, security,
        day, hour, sendTest,
      }),
      (result) => {
        setSmtpPassword('')
        setIntroduced((result && result.introduced) || [])
        setView('done')
      }
    )
  }

  const sendNow = () => run(sendEmailReportNow, () => setNote('Sent.'))
  const disconnect = () => run(disconnectEmailReport, () => setView('auto'))
  const preview = () => window.open(emailReportPreviewUrl(), '_blank', 'noopener')

  if (view === 'done') {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-4 mb-6 text-sm text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-4 flex-wrap">
        <span>
          Weekly report set up — {recipientLabel(status.recipients)} will get it every{' '}
          {status.day_name} at {String(status.hour).padStart(2, '0')}:00.
          {sendTest && ' A copy just went out.'}
          {introduced.length > 0 && (
            <span className="block mt-1 text-emerald-700/80 dark:text-emerald-300/80">
              {introduced.length === 1 ? `${introduced[0]} was` : `${introduced.length} new recipients were`}
              {' '}sent a short note saying you set this up and that replying stops it.
            </span>
          )}
        </span>
        <button onClick={() => setView('auto')} className={quietBtn}>Done</button>
      </div>
    )
  }

  // --- configured: a quiet strip, loud only when the mail is not landing ---

  if (configured && view !== 'form') {
    const when = whenLabel(status)
    const tone = problem
      ? 'border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40'
      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
    return (
      <div className={`rounded-xl border ${tone} p-4 mb-6`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            {problem ? (
              <>
                <div className="text-sm font-semibold text-red-700 dark:text-red-300">
                  The weekly report isn't going out
                </div>
                <p className="text-xs text-red-600/90 dark:text-red-300/80 mt-0.5 max-w-prose">
                  {problem.message}
                </p>
                {problem.fix && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-prose">
                    {problem.fix}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Weekly report to {recipientLabel(status.recipients)}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Every {status.day_name} at {String(status.hour).padStart(2, '0')}:00
                  {when && <> · next {when}</>}
                  {status.last_sent && <> · last sent {status.last_sent.at.slice(0, 16)}</>}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button onClick={preview} disabled={busy} className={quietBtn}>Preview</button>
            <button onClick={sendNow} disabled={busy} className={quietBtn}>
              {busy ? 'Working…' : 'Send now'}
            </button>
            <button onClick={openForm} disabled={busy} className={quietBtn}>
              Edit
            </button>
          </div>
        </div>
        {/* An error is {message, fix} or an Error, never a string - it has to
            go through ErrorNote. Rendering it directly unmounts the whole
            app (React #31), which is what a bad "Send from" used to do:
            saving succeeded, the test send did not, and this strip replaced
            the form with the object still in `error`. */}
        <ErrorNote error={error} className="mt-2" />
        {!error && note && (
          <p className="text-xs mt-2 text-emerald-600 dark:text-emerald-400">{note}</p>
        )}
      </div>
    )
  }

  // --- unconfigured (or editing): the setup form --------------------------

  if (!configured && dismissed) return null

  // A blank password means "keep the stored one" only when there IS one, so
  // first-time setup still has to supply it — unless the server takes no
  // login at all, in which case there is nothing to supply.
  const needsPassword = !!smtpUser.trim() && !smtpPassword.trim() && !configured
  const chosen = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0]
  const showServer = provider === 'other' || advanced
  const incomplete =
    !to.trim() || !smtpHost.trim() || needsPassword ||
    (!sender.trim() && !smtpUser.trim())

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 mb-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {configured ? 'Edit the weekly report' : 'Email a weekly report'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-prose">
            Once a week, mail the last seven days — productive hours, the rate,
            the split by category, every day's line and every focus session — to
            whoever you name. Yourself, a parent, a study partner, a coach. The
            numbers are the same ones Beeminder is sent, corrections included.
            It sends through the email account you already have; there is
            nothing to set up or sign up for.
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

      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
        Which email account should it send from?
      </div>
      <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 w-fit mb-3" role="group" aria-label="Mail provider">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => pickProvider(p.id)}
            disabled={busy}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              provider === p.id
                ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-4">
          <Field
            label="Send it to"
            hint="One address, or several separated by commas. They will see each other's addresses."
          >
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={busy}
              placeholder="mum@example.com, me@example.com"
              autoComplete="off"
              className={inputClass}
            />
          </Field>
        </div>

        {!showServer && (
          <div className="sm:col-span-2">
            <Field
              label={`Your ${chosen.label} address`}
              hint="The report is sent from here, and this is what signs in."
            >
              <input
                value={smtpUser}
                onChange={(e) => setAccount(e.target.value)}
                disabled={busy}
                placeholder={chosen.example}
                autoComplete="off"
                className={inputClass}
              />
            </Field>
          </div>
        )}

        {showServer && (
          <>
            <div className="sm:col-span-2">
              <Field label="Sign in as" hint="Usually your full email address.">
                <input
                  value={smtpUser}
                  onChange={(e) => setSmtpUser(e.target.value)}
                  disabled={busy}
                  placeholder={chosen.example}
                  autoComplete="off"
                  className={inputClass}
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Send from" hint="Leave blank to use the address above.">
                <input
                  value={sender}
                  onChange={(e) => setSender(e.target.value)}
                  disabled={busy}
                  placeholder={smtpUser || chosen.example}
                  autoComplete="off"
                  className={inputClass}
                />
              </Field>
            </div>
          </>
        )}

        <div className="sm:col-span-2">
          <Field
            label={configured ? 'App password (blank keeps the current one)' : 'App password'}
            hint={
              chosen.appPasswordUrl ? (
                <>
                  Not your normal password — a one-off code just for this.{' '}
                  <a href={chosen.appPasswordUrl} target="_blank" rel="noreferrer" className={linkClass}>
                    Make one here
                  </a>
                  . {chosen.appPasswordSteps} Paste it exactly as shown — the
                  spaces are only there to make it readable and come off on
                  their own. It is stored on this PC only, and you can revoke
                  it any time without changing your real password.
                </>
              ) : (
                "Whatever your mail server wants for sending. Stored on this PC only."
              )
            }
          >
            <input
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              disabled={busy}
              type="password"
              placeholder={configured ? 'unchanged' : 'paste it here'}
              autoComplete="new-password"
              className={inputClass}
            />
          </Field>
        </div>

        {showServer && (
          <>
            <Field label="Mail server" hint="Your provider's outgoing (SMTP) server.">
              <input
                value={smtpHost}
                onChange={(e) => { setSmtpHost(e.target.value); setProvider('other') }}
                disabled={busy}
                placeholder="smtp.example.com"
                autoComplete="off"
                className={inputClass}
              />
            </Field>
            <Field label="Port">
              <input
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                disabled={busy}
                type="number"
                min="1"
                max="65535"
                autoComplete="off"
                className={inputClass}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Encryption" hint="587 goes with STARTTLS, 465 with SSL/TLS.">
                <Select
                  value={security}
                  onChange={(e) => setSecurity(e.target.value)}
                  disabled={busy}
                  options={[
                    { id: 'starttls', label: 'STARTTLS (port 587)' },
                    { id: 'ssl', label: 'SSL/TLS (port 465)' },
                    { id: 'none', label: 'None' },
                  ]}
                />
              </Field>
            </div>
          </>
        )}

        <div className="sm:col-span-2">
          <Field label="Send it on">
            <Select value={day} onChange={(e) => setDay(e.target.value)} disabled={busy} options={DAYS} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="At" hint="Missed while the machine was off? It goes out at the next start-up.">
            <Select value={hour} onChange={(e) => setHour(e.target.value)} disabled={busy} options={HOURS} />
          </Field>
        </div>

        {provider !== 'other' && (
          <div className="sm:col-span-4 -mt-1">
            <button
              type="button"
              onClick={() => setAdvanced((a) => !a)}
              disabled={busy}
              className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 underline"
            >
              {advanced
                ? 'Hide server settings'
                : 'Sending from a different address, or through another server?'}
            </button>
          </div>
        )}

        <div className="sm:col-span-4 flex items-center gap-3 flex-wrap">
          <button type="submit" disabled={busy || incomplete} className={primaryBtn}>
            {busy ? 'Checking with the mail server…' : configured ? 'Save' : 'Turn it on'}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 select-none">
            <input
              type="checkbox"
              checked={sendTest}
              onChange={(e) => setSendTest(e.target.checked)}
              disabled={busy}
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Send a copy now
          </label>
          {configured && (
            <button type="button" onClick={disconnect} disabled={busy} className={quietBtn}>
              Turn it off
            </button>
          )}
          {!busy && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Nothing is saved until {chosen.label === 'Something else'
                ? 'the mail server'
                : chosen.label} accepts the login.
            </span>
          )}
          <ErrorNote error={error} inline />
        </div>
      </form>
    </div>
  )
}
