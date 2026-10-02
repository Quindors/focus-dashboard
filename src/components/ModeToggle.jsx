import { useEffect, useState } from 'react'
import { fetchMode, isLocal, saveMode } from '../lib/dataSource'

// Focus / Tracker switch in the header. Both modes log exactly the same; the
// difference is only whether anything interrupts you. Tracker silences the
// off-task popups, drift alerts and the timer's peek — except inside a
// session filed under a project, which keeps its alerts. The mode lives on
// the machine running the monitor, so this renders in local mode only and
// stays hidden until the monitor answers.
const OPTIONS = [
  { id: 'focus', label: 'Focus', title: 'Alerts on: off-task popups and session drift alerts' },
  { id: 'tracker', label: 'Tracker', title: 'Logs everything the same, but stays quiet — sessions filed under a project still alert' },
]

export default function ModeToggle() {
  const [mode, setMode] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isLocal) return
    let alive = true
    // An unreachable monitor hides the switch rather than showing a stale one.
    const load = () => fetchMode()
      .then((m) => { if (alive) setMode(m) })
      .catch(() => { if (alive) setMode(null) })
    load()
    // keep in step with the tray and other tabs
    const id = setInterval(load, 15000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  if (!isLocal || !mode) return null

  const pick = async (m) => {
    if (m === mode || saving) return
    const prev = mode
    setMode(m)
    setSaving(true)
    try {
      setMode(await saveMode(m))
    } catch {
      setMode(prev) // the monitor said no or is gone — show what is really on
    }
    setSaving(false)
  }

  return (
    <div className="flex gap-1 rounded-lg bg-slate-200/70 dark:bg-slate-800 p-1" role="group" aria-label="Alert mode">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          onClick={() => pick(o.id)}
          title={o.title}
          aria-pressed={mode === o.id}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
            mode === o.id
              ? o.id === 'focus'
                ? 'bg-emerald-500 text-white shadow-sm'
                : 'bg-slate-500 text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
