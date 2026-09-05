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

// Network-level failure: the monitor isn't running / not reachable. Kept
// free of URLs and paths — it's shown to users as-is.
const UNREACHABLE = "Can't reach the cft monitor. Is it running on this PC?"

// --- monitor reachability ---------------------------------------------------
// The hosted page reads from the monitor on this PC first and, when that is
// down, from the Supabase mirror (data as of the last sync). Reads fall back;
// writes never do: mirroring is one-way (local -> cloud), so an edit made
// while the monitor is off would never reach the classifier. It has to wait.
let monitorLive = null            // null until the first probe, then true/false
const liveListeners = new Set()
function setLive(v) {
  if (v === monitorLive) return
  monitorLive = v
  liveListeners.forEach((fn) => fn(v))
}
export const isMonitorLive = () => monitorLive
export function onMonitorLive(fn) {
  liveListeners.add(fn)
  fn(monitorLive)
  return () => liveListeners.delete(fn)
}
export async function probeMonitor() {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 4000)
  try {
    const r = await fetch(`${API_BASE}/api/status`, { signal: ctl.signal })
    setLive(r.ok)
  } catch {
    setLive(false)
  } finally {
    clearTimeout(t)
  }
  return monitorLive
}

async function apiGet(path) {
  let r
  try {
    r = await fetch(`${API_BASE}${path}`)
  } catch {
    setLive(false)
    throw new Error(UNREACHABLE)
  }
  setLive(true)
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`)
  return r.json()
}

// Reads go local-first and fall back to the Supabase mirror only when the
// monitor is unreachable — never on other errors: a 500 from the monitor is a
// bug to see, not a reason to quietly show stale data. Cloud-only mode
// (VITE_DATA_SOURCE=supabase) skips the local try.
async function localFirst(local, cloud) {
  if (isLocal) {
    try {
      return await local()
    } catch (e) {
      if (e.message !== UNREACHABLE || !supabase) throw e
    }
  }
  if (!supabase) throw new Error(UNREACHABLE)
  return cloud()
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
    throw new Error(UNREACHABLE)
  }
  if (!r.ok) {
    const data = await r.json().catch(() => ({}))
    throw new Error(data.error || `${path} -> HTTP ${r.status}`)
  }
  return r.json()
}

// Session intentions ("for the next N minutes I intend to do X") live on the
// machine running the monitor — always the local API, no Supabase fallback.
// Active shape: { id, text, started_at, ends_at, status } | null.
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

// Pause the active session for one minute: the countdown freezes (its end
// moves out by the same minute) and the monitor stops watching, exactly like
// a short break. It resumes on its own; resuming early is endBreak() — a
// pause is a break under the hood — and hands the unused time back.
export async function pauseIntention() {
  return apiPost('/api/intention/pause', {})
}

// Finished focus sessions (completed or expired — the same set Beeminder
// counts), newest first, each with the mean 0-1 ALIGN over its scored rows
// (avg_align, null if none were scored) and the observed category. Local API
// first; when the monitor is off, the sessions_v view over the cloud mirror
// serves the same shape. Feeds the forest tab.
export async function fetchSessions(limit = 1000) {
  return localFirst(
    () => apiGet(`/api/sessions?limit=${limit}`),
    async () => {
      const { data, error } = await supabase
        .from('sessions_v')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(limit)
      if (error) throw new Error(error.message)
      return data
    },
  )
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
// machine like intentions, so: local API only.
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

// Leave dry-run mode (datapoints start really being sent) / forget the
// credentials entirely. Both answer with the fresh status.
export async function goLiveBeeminder() {
  return apiPost('/api/beeminder/live', {})
}

export async function disconnectBeeminder() {
  return apiPost('/api/beeminder/disconnect', {})
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

// Rows since a given Date: [{ timestamp, category_name, ai_category,
// confidence, intention_id, align_score }, ...]. intention_id and align_score
// are null outside a focus session; useFocusData needs them to count declared
// neutral work as productive, the way the monitor's Beeminder totals do.
export async function fetchFocusRows(since) {
  return localFirst(
    () => apiGet(`/api/focus?since=${encodeURIComponent(localStamp(since))}`),
    async () => {
      // The mirror stores the monitor's naive local stamps as-is (they land
      // as +00), so the comparison value must be the same naive string — an
      // ISO/UTC instant would be off by the whole timezone offset.
      const { data, error } = await supabase
        .from('focus_logs')
        .select('timestamp, category_name, human_label, confidence, intention_id, align_score')
        .gte('timestamp', localStamp(since))
        .order('timestamp', { ascending: false })
      if (error) throw new Error(error.message)
      // Same effective label the local API reports: a human correction wins.
      return data.map((r) => ({
        timestamp: r.timestamp,
        category_name: (r.human_label || '').trim() || r.category_name,
        ai_category: r.category_name,
        confidence: r.confidence,
        intention_id: r.intention_id ?? null,
        align_score: r.align_score ?? null,
      }))
    },
  )
}

// Categories: [{ name, is_productive }, ...]
export async function fetchCategories() {
  return localFirst(
    () => apiGet('/api/categories'),
    async () => {
      const { data, error } = await supabase.from('categories').select('name, description, is_productive')
      if (error) throw new Error(error.message)
      return data
    },
  )
}

// Recent events for the review tab:
// [{ id, timestamp, current_window, category_name, confidence, human_label, reason }, ...]
export async function fetchRecentEvents(limit = 200) {
  return localFirst(
    () => apiGet(`/api/events?limit=${limit}`),
    async () => {
      const { data, error } = await supabase
        .from('focus_logs')
        .select('id, timestamp, current_window, category_name, confidence, human_label, reason, intention_id, align_score')
        .not('current_window', 'is', null)
        .order('timestamp', { ascending: false })
        .limit(limit)
      if (error) throw new Error(error.message)
      return data
    },
  )
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

// The monitor's learned correction rules — one per exact window title whose
// newest human label differs from what the AI said:
// [{ window_title, ai_category, corrected_category, rows, last_at }, ...]
export async function fetchCorrections() {
  if (isLocal) {
    return apiGet('/api/corrections')
  }
  const { data, error } = await supabase
    .from('focus_logs')
    .select('current_window, category_name, human_label, timestamp')
    .not('human_label', 'is', null)
    .order('timestamp', { ascending: false })
    .limit(5000)
  if (error) throw new Error(error.message)
  const out = new Map()
  for (const r of data) {
    const w = (r.current_window || '').trim()
    const ai = (r.category_name || '').trim()
    const human = (r.human_label || '').trim()
    if (!w || !human || human.toLowerCase() === ai.toLowerCase()) continue
    const cur = out.get(w)
    if (cur) cur.rows += 1
    else out.set(w, { window_title: w, ai_category: ai, corrected_category: human, rows: 1, last_at: r.timestamp })
  }
  return [...out.values()]
}

// Retarget a correction rule to a new category, or remove it (humanLabel =
// null). Applies to every corrected row of that exact window title; rows
// whose label merely agrees with the AI are left alone.
export async function updateCorrectionRule(windowTitle, humanLabel) {
  if (isLocal) {
    return apiPost('/api/corrections/update', { window_title: windowTitle, human_label: humanLabel })
  }
  const { data, error } = await supabase
    .from('focus_logs')
    .select('id, category_name, human_label')
    .eq('current_window', windowTitle)
    .not('human_label', 'is', null)
  if (error) throw new Error(error.message)
  const ids = (data || [])
    .filter((r) => (r.human_label || '').trim() &&
      (r.human_label || '').trim().toLowerCase() !== (r.category_name || '').trim().toLowerCase())
    .map((r) => r.id)
  if (!ids.length) throw new Error('no corrected rows for that window title')
  const upd = await supabase.from('focus_logs').update({ human_label: humanLabel }).in('id', ids)
  if (upd.error) throw new Error(upd.error.message)
  return { ok: true, window_title: windowTitle, human_label: humanLabel, rows: ids.length }
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
