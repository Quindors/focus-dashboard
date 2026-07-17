import { supabase } from './supabase'

const SOURCE = import.meta.env.VITE_DATA_SOURCE || 'supabase'
export const isLocal = SOURCE === 'local'

// Format a Date as the naive local "YYYY-MM-DD HH:MM:SS" string that the
// desktop monitor uses for focus_logs.timestamp, so the local API's string
// comparison lines up.
function localStamp(d) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}

async function apiGet(path) {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`)
  return r.json()
}

// Rows since a given Date: [{ timestamp, category_name, confidence }, ...]
export async function fetchFocusRows(since) {
  if (isLocal) {
    return apiGet(`/api/focus?since=${encodeURIComponent(localStamp(since))}`)
  }
  const { data, error } = await supabase
    .from('focus_logs')
    .select('timestamp, category_name, confidence')
    .gte('timestamp', since.toISOString())
    .order('timestamp', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

// Categories: [{ name, is_productive }, ...]
export async function fetchCategories() {
  if (isLocal) {
    return apiGet('/api/categories')
  }
  const { data, error } = await supabase.from('categories').select('name, is_productive')
  if (error) throw new Error(error.message)
  return data
}

// Recent events for the review tab:
// [{ id, timestamp, current_window, category_name, confidence, human_label, reason }, ...]
export async function fetchRecentEvents(limit = 200) {
  if (isLocal) {
    return apiGet(`/api/events?limit=${limit}`)
  }
  const { data, error } = await supabase
    .from('focus_logs')
    .select('id, timestamp, current_window, category_name, confidence, human_label, reason')
    .not('current_window', 'is', null)
    .order('timestamp', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return data
}

// Save (or clear, with humanLabel = null) a human correction on one event.
export async function saveCorrection(id, humanLabel) {
  if (isLocal) {
    const r = await fetch('/api/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, human_label: humanLabel }),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error(body.error || `/api/correct -> HTTP ${r.status}`)
    }
    return r.json()
  }
  const { error } = await supabase
    .from('focus_logs')
    .update({ human_label: humanLabel })
    .eq('id', id)
  if (error) throw new Error(error.message)
  return { ok: true, id, human_label: humanLabel }
}
