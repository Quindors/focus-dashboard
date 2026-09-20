import { durationMin, parseTs } from './forestDraw'

// The project forest's life model: which sessions water a project, how a
// tree's health follows from its last watering, and where one life ends
// and the next begins. Pure functions of session history and a clock —
// nothing is stored, so the local API and the cloud mirror agree.

export const WATER_MIN_ALIGN = 0.7
export const FRESH_DAYS = 7
export const FADE_DAYS = 21
export const DEAD_DAYS = 45
const DAY = 86400000

// A hair of tolerance: an AVG() of 0.7s can land a float below 0.7.
export const isWatering = (s) => s.avg_align != null && s.avg_align >= WATER_MIN_ALIGN - 1e-6

// Health states, in the order a neglected tree passes through them.
export const STATES = {
  seedling: { label: 'Seedling', tone: 'text-emerald-600 dark:text-emerald-400', dot: '#8FB756', season: 'ff-spring' },
  thriving: { label: 'Thriving', tone: 'text-emerald-600 dark:text-emerald-400', dot: '#2F7256', season: 'ff-summer' },
  fading:   { label: 'Fading', tone: 'text-amber-600 dark:text-amber-400', dot: '#D69A4B', season: 'ff-autumn' },
  wilting:  { label: 'Wilting', tone: 'text-orange-700 dark:text-orange-400', dot: '#B26F1F', season: 'ff-autumn' },
  dead:     { label: 'Withered', tone: 'text-slate-500 dark:text-slate-400', dot: '#8A8478', season: 'ff-winter' },
  dormant:  { label: 'Dormant', tone: 'text-sky-600 dark:text-sky-400', dot: '#93A995', season: 'ff-winter' },
}

const endT = (s) => parseTs(s.ended_at || s.started_at).getTime()

// Everything the scene needs to know about one project, from its sessions.
export function projectLife(project, sessions, now) {
  const rows = sessions
    .filter((s) => s.project_id === project.id && s.started_at && s.ended_at)
    .sort((a, b) => endT(a) - endT(b))
  const waterings = rows.filter(isWatering)
  // The clock starts when the project is planted. Sessions filed in from
  // before that are history the tree grows from, never days it went dry:
  // a project made today out of old sessions starts thriving, with all of
  // them as plants, and its first dry day is tomorrow.
  const createdT = parseTs(project.created_at).getTime() || now
  const since = (t) => Math.max(t, createdT)
  // Lives: a run of waterings with no gap longer than DEAD_DAYS. Every gap
  // beyond that is a death; the tree that follows is a new one.
  const lives = []
  for (const w of waterings) {
    const t = endT(w)
    const cur = lives[lives.length - 1]
    if (!cur || t - since(cur.lastT) > DEAD_DAYS * DAY) lives.push({ startT: t, lastT: t, waterings: [w] })
    else { cur.waterings.push(w); cur.lastT = t }
  }
  const life = lives[lives.length - 1] || null
  const lastT = life ? since(life.lastT) : createdT
  const days = Math.max(0, (now - lastT) / DAY)
  let state
  if (project.status === 'archived') state = 'dormant'
  else if (days > DEAD_DAYS) state = 'dead'
  else if (!life) state = 'seedling'
  else if (days <= FRESH_DAYS) state = 'thriving'
  else if (days <= FADE_DAYS) state = 'fading'
  else state = 'wilting'
  // The current life owns every session since the previous death — the
  // unwatered ones too: they are plants around the tree, just not water.
  const prevDeathT = lives.length > 1 ? since(lives[lives.length - 2].lastT) + DEAD_DAYS * DAY : -Infinity
  const lifeRows = state === 'dead' ? [] : rows.filter((s) => endT(s) >= prevDeathT)
  const lifeWaterings = life && state !== 'dead' ? life.waterings : []
  const hours = lifeRows.reduce((a, s) => a + durationMin(s), 0) / 60
  const allHours = rows.reduce((a, s) => a + durationMin(s), 0) / 60
  const recent = lifeWaterings.slice(-5)
  const recentAlign = recent.length ? recent.reduce((a, s) => a + s.avg_align, 0) / recent.length : null
  // Every life but the current one stands as a snag; a dead current tree
  // is drawn as one itself, so it is never counted twice.
  const snags = Math.max(0, lives.length - 1)
  const daysLeft = state === 'fading' || state === 'wilting' || state === 'thriving' || state === 'seedling'
    ? Math.max(0, Math.ceil(DEAD_DAYS - days)) : 0
  return { project, rows, lifeRows, lifeWaterings, waterings, state, days, daysLeft, hours, allHours, recentAlign, snags, lastT }
}
