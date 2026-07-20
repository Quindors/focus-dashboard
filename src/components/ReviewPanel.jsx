import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchRecentEvents, fetchCategories, saveCorrections } from '../lib/dataSource'

const POLL_MS = 15000
const GROUP_GAP_MS = 15 * 60 * 1000 // >15 min between events breaks a group

// Match the monitor's title normalization so "(3) Gmail" groups with "Gmail".
function normTitle(t) {
  let s = (t || '').trim()
  if (s.toUpperCase().startsWith('WIN:')) s = s.slice(4)
  s = s.replace(/^\(\d+\)\s*/, '')
  return s.split(/\s+/).join(' ').toLowerCase()
}

// "6:31 PM" today, "Jul 15 6:31 PM" otherwise.
function timeLabel(ts) {
  const d = new Date(ts)
  if (isNaN(d)) return ts || ''
  const sameDay = d.toDateString() === new Date().toDateString()
  const hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return sameDay ? hm : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${hm}`
}

// Lump consecutive events with the same normalized window title, AI category,
// and correction state into one row. Events come newest-first; a gap larger
// than GROUP_GAP_MS starts a new group even if the window is the same.
function groupEvents(events) {
  const groups = []
  let cur = null
  for (const e of events) {
    const key = `${normTitle(e.current_window)}|${e.category_name || ''}|${e.human_label || ''}`
    const t = new Date(e.timestamp).getTime()
    const fits =
      cur &&
      cur.matchKey === key &&
      (isNaN(t) || isNaN(cur.earliestMs) || cur.earliestMs - t <= GROUP_GAP_MS)
    if (fits) {
      cur.ids.push(e.id)
      cur.earliest = e.timestamp
      cur.earliestMs = t
      cur.count += 1
    } else {
      cur = {
        matchKey: key,
        key: e.id, // stable per group: newest event's id
        ids: [e.id],
        current_window: e.current_window,
        reason: e.reason,
        category_name: e.category_name,
        confidence: e.confidence,
        human_label: e.human_label,
        latest: e.timestamp,
        earliest: e.timestamp,
        earliestMs: t,
        count: 1,
      }
      groups.push(cur)
    }
  }
  return groups
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

// One grouped row: what the AI said, and a dropdown to fix every event in it.
function GroupRow({ group, categories, productiveMap, onCorrect, busy }) {
  const corrected = !!group.human_label && group.human_label !== group.category_name
  const effective = group.human_label || group.category_name || ''
  const single = group.count === 1

  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 last:border-0">
      {/* Grouped ranges stack start/end on two lines so the column stays narrow. */}
      <td className="py-2 pr-3 text-xs text-slate-400 dark:text-slate-500 whitespace-nowrap align-top">
        {single ? (
          timeLabel(group.latest)
        ) : (
          <>
            <div>{timeLabel(group.earliest)}</div>
            <div>–{timeLabel(group.latest)}</div>
          </>
        )}
      </td>
      <td className="py-2 pr-3 align-top max-w-0 w-full">
        <div className="text-sm text-slate-700 dark:text-slate-200 truncate" title={group.current_window}>
          {!single && (
            <span className="mr-1.5 inline-block px-1.5 rounded bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400 font-medium">
              ×{group.count}
            </span>
          )}
          {group.current_window}
        </div>
        {group.reason && (
          <div className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5" title={group.reason}>
            {group.reason}
          </div>
        )}
      </td>
      <td className="py-2 pr-3 align-top whitespace-nowrap">
        <CategoryChip name={group.category_name || '—'} isProductive={productiveMap[group.category_name]} />
        {group.confidence != null && (
          <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-500">
            {Math.round(group.confidence * 100)}%
          </span>
        )}
      </td>
      <td className="py-2 align-top whitespace-nowrap">
        <div className="flex items-center gap-2">
          <select
            value={effective}
            disabled={busy}
            onChange={(e) => onCorrect(group, e.target.value)}
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
              onClick={() => onCorrect(group, null)}
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
  const [savingKeys, setSavingKeys] = useState(new Set())
  const [refreshing, setRefreshing] = useState(false)
  const [onlyLowConfidence, setOnlyLowConfidence] = useState(false)
  const savingRef = useRef(savingKeys)
  savingRef.current = savingKeys

  const load = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const [evts, cats] = await Promise.all([fetchRecentEvents(500), fetchCategories()])
      setEvents(evts)
      setCategories(cats)
      setError(null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      if (!silent) setRefreshing(false)
    }
  }, [])

  // Initial load + auto-refresh. Polls pause while the tab is hidden or a
  // correction is saving (so the list doesn't shift under an in-flight edit),
  // and coming back to the tab refreshes immediately.
  useEffect(() => {
    load()
    const id = setInterval(() => {
      if (savingRef.current.size === 0 && !document.hidden) load(true)
    }, POLL_MS)
    const onVisible = () => {
      if (!document.hidden && savingRef.current.size === 0) load(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const productiveMap = {}
  for (const c of categories) productiveMap[c.name] = c.is_productive

  async function handleCorrect(group, newCategory) {
    // Picking the AI's own category (or "undo") clears the correction.
    const label = newCategory && newCategory !== group.category_name ? newCategory : null
    setSavingKeys((s) => new Set(s).add(group.key))
    try {
      await saveCorrections(group.ids, label)
      const idSet = new Set(group.ids)
      setEvents((rows) => rows.map((r) => (idSet.has(r.id) ? { ...r, human_label: label } : r)))
      setError(null)
    } catch (e) {
      setError(`Could not save correction: ${e.message || e}`)
    } finally {
      setSavingKeys((s) => {
        const next = new Set(s)
        next.delete(group.key)
        return next
      })
    }
  }

  const groups = groupEvents(events || [])
  const shown = groups.filter(
    (g) => !onlyLowConfidence || g.human_label || g.confidence == null || g.confidence < 0.8
  )
  const correctedCount = groups.filter(
    (g) => g.human_label && g.human_label !== g.category_name
  ).length

  return (
    <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors">
      <div className="flex items-center justify-between mb-1 gap-4 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          Review recent activity
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
            onClick={() => load()}
            disabled={refreshing}
            className="text-xs px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
        Similar back-to-back events are grouped into one row — correcting it fixes every
        event in the group. Corrections teach the monitor going forward.
        {correctedCount > 0 && ` ${correctedCount} corrected.`}
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
      {events === null && !error && <p className="text-slate-500 dark:text-slate-400 text-sm">Loading…</p>}
      {events !== null && shown.length === 0 && (
        <p className="text-slate-400 dark:text-slate-500 text-sm">No activity to review.</p>
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="pb-2 pr-3 font-medium w-20">Time</th>
                <th className="pb-2 pr-3 font-medium">Window</th>
                <th className="pb-2 pr-3 font-medium w-40">AI category</th>
                <th className="pb-2 font-medium w-48">Correct to</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => (
                <GroupRow
                  key={g.key}
                  group={g}
                  categories={categories}
                  productiveMap={productiveMap}
                  onCorrect={handleCorrect}
                  busy={savingKeys.has(g.key)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
