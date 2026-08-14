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
  let r
  try {
    r = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error(
      API_BASE
        ? `Can't reach the cft monitor at ${API_BASE}. Is it running on this PC?`
        : `Can't reach the local API at ${path}.`
    )
  }
  if (!r.ok) {
    const data = await r.json().catch(() => ({}))
    throw new Error(data.error || `${path} -> HTTP ${r.status}`)
  }
  return r.json()
}

// Monitor mode: 'distraction_free' (alerts on) or 'time_tracking' (log only,
// no alerts). Mode lives on the machine running the monitor, so this always
// talks to the local API — there is no Supabase fallback.
export async function fetchMode() {
  const d = await apiGet('/api/mode')
  return d.mode
}

export async function saveMode(mode) {
  return apiPost('/api/mode', { mode })
}

// Session intentions ("for the next N minutes I intend to do X") live on the
// machine running the monitor, like mode — always the local API, no Supabase
// fallback. Active shape: { id, text, started_at, ends_at, status } | null.
export async function fetchIntention() {
  const d = await apiGet('/api/intention')
  return d.active
}

export async function startIntention(text, durationMin) {
  const d = await apiPost('/api/intention', { text, duration_min: durationMin })
  return d.active
}

// status: 'completed' | 'abandoned'. Completing a session rolls straight into
// the post-session break; abandoning one doesn't.
export async function endIntention(status) {
  const d = await apiPost('/api/intention/end', { status })
  return d.ended
}

// The monitor's resolved view of right now — phase ('break' | 'session' |
// 'idle'), a color state, a label and a countdown. The desktop timer widget
// and the tray icon render from this same payload, so what you see here and
// what floats on your screen can't disagree.
export async function fetchStatus() {
  return apiGet('/api/status')
}

// Breaks: a fixed stretch with the monitor fully off — nothing classified,
// nothing logged, no alerts, no intention needed. Live on the monitor's
// machine like mode and intentions, so: local API only.
export async function fetchBreak() {
  const d = await apiGet('/api/break')
  return d.active
}

export async function startBreak(durationMin) {
  const d = await apiPost('/api/break', { duration_min: durationMin })
  return d.active
}

export async function endBreak() {
  const d = await apiPost('/api/break/end', {})
  return d.ended
}

// Beeminder setup lives in the monitor's .env, so: local API only. The GET
// reports whether it's configured (never the token); the POST verifies the
// credentials against Beeminder before saving, so a bad token or goal slug
// comes back as a readable error instead of half-saved config.
export async function fetchBeeminder() {
  return apiGet('/api/beeminder')
}

export async function saveBeeminder({
  user, token, focusGoal, sessionsGoal, createGoal, hoursPerDay, leewayDays,
}) {
  return apiPost('/api/beeminder', {
    user,
    token,
    focus_goal: focusGoal,
    sessions_goal: sessionsGoal || '',
    create_goal: !!createGoal,
    hours_per_day: hoursPerDay,
    leeway_days: leewayDays,
  })
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

// Delete a category. Its logged rows are reassigned to `reassignTo` rather
// than deleted, so history is never lost. Ambiguous/System are protected.
export async function deleteCategory(name, reassignTo = 'Ambiguous') {
  if (isLocal) {
    return apiPost('/api/category/delete', { name, reassign_to: reassignTo })
  }
  const a = await supabase
    .from('focus_logs')
    .update({ category_name: reassignTo })
    .eq('category_name', name)
  if (a.error) throw new Error(a.error.message)
  const b = await supabase.from('focus_logs').update({ human_label: reassignTo }).eq('human_label', name)
  if (b.error) throw new Error(b.error.message)
  const { error } = await supabase.from('categories').delete().eq('name', name)
  if (error) throw new Error(error.message)
  return { ok: true, deleted: name, reassigned_to: reassignTo }
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
