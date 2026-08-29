import { useCallback, useEffect, useState } from 'react'
import { fetchCorrections, fetchCategories, updateCorrectionRule } from '../lib/dataSource'

// "6:31 PM" today, "Jul 15 6:31 PM" otherwise.
function timeLabel(ts) {
  const d = new Date(ts)
  if (isNaN(d)) return ts || ''
  const sameDay = d.toDateString() === new Date().toDateString()
  const hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return sameDay ? hm : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${hm}`
}

function CategoryChip({ name, isProductive }) {
  const tone =
    isProductive === true
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
      : isProductive === false
        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${tone}`}>
      {name}
    </span>
  )
}

// One correction rule: the exact window title it pins, what the AI said, and
// what the user corrected it to — editable, or removable outright.
function RuleRow({ rule, categories, productiveMap, onChange, onRemove, busy }) {
  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 last:border-0">
      <td className="py-2 pr-3 align-top max-w-0 w-full">
        <div className="text-sm text-slate-700 dark:text-slate-200 truncate" title={rule.window_title}>
          {rule.window_title}
        </div>
        <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          {rule.rows === 1 ? '1 event' : `${rule.rows} events`} · last {timeLabel(rule.last_at)}
        </div>
      </td>
      <td className="py-2 pr-3 align-top whitespace-nowrap">
        <CategoryChip name={rule.ai_category || '—'} isProductive={productiveMap[rule.ai_category]} />
      </td>
      <td className="py-2 pr-3 align-top whitespace-nowrap">
        <select
          value={rule.corrected_category}
          disabled={busy}
          onChange={(e) => onChange(rule, e.target.value)}
          className="text-sm rounded-md border px-2 py-1 bg-white dark:bg-slate-800 transition-colors
            border-amber-400 text-amber-700 dark:border-amber-500 dark:text-amber-300 disabled:opacity-50"
        >
          {!categories.some((c) => c.name === rule.corrected_category) && (
            <option value={rule.corrected_category}>{rule.corrected_category}</option>
          )}
          {categories.map((c) => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
      </td>
      <td className="py-2 align-top whitespace-nowrap">
        <button
          onClick={() => onRemove(rule)}
          disabled={busy}
          title="Remove this correction — the AI's own category stands again"
          className="text-xs text-slate-400 hover:text-red-600 dark:text-slate-500 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
        >
          remove
        </button>
      </td>
    </tr>
  )
}

export default function CorrectionsPanel() {
  const [rules, setRules] = useState(null)
  const [categories, setCategories] = useState([])
  const [error, setError] = useState(null)
  const [busyTitles, setBusyTitles] = useState(new Set())
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const [rls, cats] = await Promise.all([fetchCorrections(), fetchCategories()])
      setRules(rls)
      setCategories(cats)
      setError(null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      if (!silent) setRefreshing(false)
    }
  }, [])

  useEffect(() => { load(true) }, [load])

  const productiveMap = {}
  for (const c of categories) productiveMap[c.name] = c.is_productive

  async function apply(rule, label) {
    setBusyTitles((s) => new Set(s).add(rule.window_title))
    try {
      await updateCorrectionRule(rule.window_title, label)
      setRules((rs) =>
        label === null
          ? rs.filter((r) => r.window_title !== rule.window_title)
          : rs.map((r) => (r.window_title === rule.window_title ? { ...r, corrected_category: label } : r))
      )
      setError(null)
    } catch (e) {
      setError(`Could not update correction: ${e.message || e}`)
    } finally {
      setBusyTitles((s) => {
        const next = new Set(s)
        next.delete(rule.window_title)
        return next
      })
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors mt-6">
      <div className="flex items-center justify-between mb-1 gap-4 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          Learned corrections
        </h2>
        <button
          onClick={() => load()}
          disabled={refreshing}
          className="text-xs px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
        Every correction you make in Review becomes a rule for that exact window title —
        the monitor pins it to your category from then on (recent rules also steer similar
        windows). Change a rule here, or remove it to let the AI judge that window again.
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
      {rules === null && !error && <p className="text-slate-500 dark:text-slate-400 text-sm">Loading…</p>}
      {rules !== null && rules.length === 0 && (
        <p className="text-slate-400 dark:text-slate-500 text-sm">
          No corrections yet — fix a category in Review above and it will show up here.
        </p>
      )}

      {rules !== null && rules.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="pb-2 pr-3 font-medium">Window</th>
                <th className="pb-2 pr-3 font-medium w-36">AI said</th>
                <th className="pb-2 pr-3 font-medium w-48">Corrected to</th>
                <th className="pb-2 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <RuleRow
                  key={r.window_title}
                  rule={r}
                  categories={categories}
                  productiveMap={productiveMap}
                  onChange={(rule, label) => apply(rule, label)}
                  onRemove={(rule) => apply(rule, null)}
                  busy={busyTitles.has(r.window_title)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
