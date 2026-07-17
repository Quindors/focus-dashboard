import { useCallback, useEffect, useState } from 'react'
import { fetchRecentEvents, fetchCategories, saveCorrection } from '../lib/dataSource'

// "14:32" from the monitor's naive local timestamp.
function timeLabel(ts) {
  const d = new Date(ts)
  if (isNaN(d)) return ts || ''
  const sameDay = d.toDateString() === new Date().toDateString()
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

// One event row: what the AI said, and a dropdown to fix it.
function EventRow({ event, categories, productiveMap, onCorrect, busy }) {
  const corrected = !!event.human_label && event.human_label !== event.category_name
  const effective = event.human_label || event.category_name || ''

  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 last:border-0">
      <td className="py-2 pr-3 text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap align-top">
        {timeLabel(event.timestamp)}
      </td>
      <td className="py-2 pr-3 align-top max-w-0 w-full">
        <div className="text-sm text-slate-700 dark:text-slate-200 truncate" title={event.current_window}>
          {event.current_window}
        </div>
        {event.reason && (
          <div className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5" title={event.reason}>
            {event.reason}
          </div>
        )}
      </td>
      <td className="py-2 pr-3 align-top whitespace-nowrap">
        <CategoryChip name={event.category_name || '—'} isProductive={productiveMap[event.category_name]} />
        {event.confidence != null && (
          <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-500">
            {Math.round(event.confidence * 100)}%
          </span>
        )}
      </td>
      <td className="py-2 align-top whitespace-nowrap">
        <div className="flex items-center gap-2">
          <select
            value={effective}
            disabled={busy}
            onChange={(e) => onCorrect(event, e.target.value)}
            className={`text-sm rounded-md border px-2 py-1 bg-white dark:bg-slate-800 transition-colors
              ${corrected
                ? 'border-amber-400 text-amber-700 dark:border-amber-500 dark:text-amber-300'
                : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}
              disabled:opacity-50`}
          >
            {!categories.some((c) => c.name === effective) && effective && (
              <option value={effective}>{effective}</option>
            )}
            {categories.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          {corrected && (
            <button
              onClick={() => onCorrect(event, null)}
              disabled={busy}
              title="Undo correction — revert to the AI's category"
              className="text-xs text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 disabled:opacity-50"
            >
              undo
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

export default function ReviewPanel() {
  const [events, setEvents] = useState(null)
  const [categories, setCategories] = useState([])
  const [error, setError] = useState(null)
  const [savingIds, setSavingIds] = useState(new Set())
  const [refreshing, setRefreshing] = useState(false)
  const [onlyLowConfidence, setOnlyLowConfidence] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const [evts, cats] = await Promise.all([fetchRecentEvents(200), fetchCategories()])
      setEvents(evts)
      setCategories(cats)
      setError(null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const productiveMap = {}
  for (const c of categories) productiveMap[c.name] = c.is_productive

  async function handleCorrect(event, newCategory) {
    // Picking the AI's own category (or "undo") clears the correction.
    const label = newCategory && newCategory !== event.category_name ? newCategory : null
    setSavingIds((s) => new Set(s).add(event.id))
    try {
      await saveCorrection(event.id, label)
      setEvents((rows) => rows.map((r) => (r.id === event.id ? { ...r, human_label: label } : r)))
      setError(null)
    } catch (e) {
      setError(`Could not save correction: ${e.message || e}`)
    } finally {
      setSavingIds((s) => {
        const next = new Set(s)
        next.delete(event.id)
        return next
      })
    }
  }

  const shown = (events || []).filter(
    (e) => !onlyLowConfidence || e.human_label || e.confidence == null || e.confidence < 0.8
  )
  const correctedCount = (events || []).filter(
    (e) => e.human_label && e.human_label !== e.category_name
  ).length

  return (
    <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors">
      <div className="flex items-center justify-between mb-1 gap-4 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          Review recent events
        </h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyLowConfidence}
              onChange={(e) => setOnlyLowConfidence(e.target.checked)}
              className="accent-emerald-500"
            />
            low confidence only
          </label>
          <button
            onClick={load}
            disabled={refreshing}
            className="text-xs px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
        Fix any events the AI got wrong — corrections are saved immediately and teach the
        monitor going forward.{correctedCount > 0 && ` ${correctedCount} corrected.`}
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
      {events === null && !error && <p className="text-slate-500 dark:text-slate-400 text-sm">Loading…</p>}
      {events !== null && shown.length === 0 && (
        <p className="text-slate-400 dark:text-slate-500 text-sm">No events to review.</p>
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="pb-2 pr-3 font-medium w-16">Time</th>
                <th className="pb-2 pr-3 font-medium">Window</th>
                <th className="pb-2 pr-3 font-medium w-40">AI category</th>
                <th className="pb-2 font-medium w-48">Correct to</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  categories={categories}
                  productiveMap={productiveMap}
                  onCorrect={handleCorrect}
                  busy={savingIds.has(e.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
