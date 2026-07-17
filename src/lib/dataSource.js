import { supabase } from './supabase'

const SOURCE = import.meta.env.VITE_DATA_SOURCE || 'supabase'
export const isLocal = SOURCE === 'local'

// Where the local API lives. Empty = same origin (dashboard bundled in the exe).
// When the dashboard is hosted (Vercel), set VITE_API_BASE to the monitor's
// fixed local port, e.g. http://127.0.0.1:47113 — the hosted page then reads
// data straight off your machine and nothing leaves it.
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')

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
  let r
  try {
    r = await fetch(`${API_BASE}${path}`)
  } catch {
    // Network-level failure: the monitor isn't running / not reachable.
    throw new Error(
      API_BASE
        ? `Can't reach the cft monitor at ${API_BASE}. Is it running on this PC?`
        : `Can't reach the local API at ${path}.`
    )
  }
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`)
  return r.json()
}

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const data = await r.json().catch(() => ({}))
    throw new Error(data.error || `${path} -> HTTP ${r.status}`)
  }
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
    const r = await fetch(`${API_BASE}/api/correct`, {
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

// Save the same correction on a batch of events (a grouped review row).
export async function saveCorrections(ids, humanLabel) {
  if (isLocal) {
    await Promise.all(ids.map((id) => saveCorrection(id, humanLabel)))
    return { ok: true, ids, human_label: humanLabel }
  }
  const { error } = await supabase
    .from('focus_logs')
    .update({ human_label: humanLabel })
    .in('id', ids)
  if (error) throw new Error(error.message)
  return { ok: true, ids, human_label: humanLabel }
}

// Add a category. is_productive: true / false / null (neutral).
export async function addCategory({ name, description, is_productive }) {
  if (isLocal) {
    return apiPost('/api/category', { name, description, is_productive })
  }
  const { error } = await supabase
    .from('categories')
    .insert({ name, description, is_productive })
  if (error) throw new Error(error.message)
  return { ok: true, name }
}

// Edit a category. Pass newName to rename (log history follows the rename).
export async function updateCategory(name, { newName, description, is_productive }) {
  if (isLocal) {
    return apiPost('/api/category/update', {
      name,
      new_name: newName,
      description,
      is_productive,
    })
  }
  const target = newName || name
  const { error } = await supabase
    .from('categories')
    .update({ name: target, description, is_productive })
    .eq('name', name)
  if (error) throw new Error(error.message)
  if (target !== name) {
    const a = await supabase.from('focus_logs').update({ category_name: target }).eq('category_name', name)
    if (a.error) throw new Error(a.error.message)
    const b = await supabase.from('focus_logs').update({ human_label: target }).eq('human_label', name)
    if (b.error) throw new Error(b.error.message)
  }
  return { ok: true, name: target }
}
