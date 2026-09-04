import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchSessions } from '../lib/dataSource'

// The forest tab: every finished session (completed or expired — the same set
// Beeminder counts) is a tree, planted in the grove of the month it happened.
// Species = category, size = duration, foliage depth = mean ALIGN. Abandoned
// sessions never appear: the forest is purely positive, punishment stays
// Beeminder's job. Rendering is imperative SVG (turbulence-displaced shapes
// for a painterly look) driven entirely by CSS variables, so the dashboard's
// .dark class flips the scenes to night without re-rendering.

// Species are assigned from the user's REAL categories, not a seeded list:
// name heuristics pick a fitting look, anything unmatched gets a stable one
// by hash, and sessions from before the intention gate (null category) stand
// as sage "Uncategorized" trees.
const LOOKS = ['pine', 'leaf', 'maple', 'cherry', 'cypress']
const nameHash = (s) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7)
function speciesFor(cat) {
  if (!cat) return { kind: 'other', label: 'Uncategorized' }
  const c = cat.toLowerCase()
  let kind
  if (/(project|cft|deep|build|code)/.test(c)) kind = 'pine'
  else if (/(research|learn|read|stud|homework|school)/.test(c)) kind = 'leaf'
  else if (/(college|application|essay|writ)/.test(c)) kind = 'maple'
  else if (/(communicat|email|chat|social)/.test(c)) kind = 'cherry'
  else if (/(music|clarinet|composit|audio|piano|band)/.test(c)) kind = 'cypress'
  else kind = LOOKS[nameHash(c) % LOOKS.length]
  return { kind, label: cat }
}
const EMPTY = []

// Milestones are cumulative over the whole forest; each earned one becomes a
// permanent landmark in the grove of the month it was reached.
const MILESTONES = [
  { id: 'pond', name: 'The pond', what: '25th tree', test: (c) => c.count >= 25 },
  { id: 'lantern', name: 'The lantern', what: '30 hours', test: (c) => c.hours >= 30 },
  { id: 'bench', name: 'The bench', what: '40th tree', test: (c) => c.count >= 40 },
  { id: 'cabin', name: 'The cabin', what: '100th tree', test: (c) => c.count >= 100, left: (s) => `${100 - s.count} trees away`, pct: (s) => s.count },
  { id: 'falls', name: 'The falls', what: '100 hours', test: (c) => c.hours >= 100, left: (s) => `${Math.ceil(100 - s.hours)} hours away`, pct: (s) => s.hours },
]

const NS = 'http://www.w3.org/2000/svg'
function el(n, a, parent) {
  const e = document.createElementNS(NS, n)
  for (const k in a) e.setAttribute(k, a[k])
  if (parent) parent.appendChild(e)
  return e
}
const jitter = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.545; return x - Math.floor(x) }
const pts = (arr, sc) => arr.map((p) => `${p[0] * sc},${p[1] * sc}`).join(' ')

// Foliage as a continuous scale: ALIGN 50%..95% sweeps the species ramp from
// pale to rich via color-mix, so an 82% session is visibly between an 74% and
// an 89% one. Stays theme-adaptive because the endpoints are CSS variables.
// Unscored sessions sit at the middle of the ramp.
function foliageFill(kind, align) {
  const t = align == null ? 0.5 : Math.max(0, Math.min(1, (align - 0.5) / 0.45))
  if (t <= 0.5) {
    return `color-mix(in oklab, var(--ff-${kind}-1) ${Math.round(t * 200)}%, var(--ff-${kind}-0))`
  }
  return `color-mix(in oklab, var(--ff-${kind}-2) ${Math.round((t - 0.5) * 200)}%, var(--ff-${kind}-1))`
}

// y of a hill-ellipse's upper edge at x — trees stand ON the terrain curves
// the backdrop draws, instead of in flat rows.
function hillY(x, cx, cy, rx, ry) {
  const t = (x - cx) / rx
  return Math.abs(t) >= 1 ? cy : cy - ry * Math.sqrt(1 - t * t)
}

const parseTs = (s) => new Date(String(s).replace(' ', 'T'))
function durationMin(s) {
  const a = parseTs(s.started_at), b = parseTs(s.ended_at || s.started_at)
  const m = Math.round((b - a) / 60000)
  return Number.isFinite(m) && m > 0 ? m : 0
}
const monthKey = (s) => String(s.started_at).slice(0, 7)
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
function seasonClass(key) {
  const m = Number(key.split('-')[1])
  if (m >= 3 && m <= 5) return 'ff-spring'
  if (m >= 6 && m <= 8) return 'ff-summer'
  if (m >= 9 && m <= 11) return 'ff-autumn'
  return 'ff-winter'
}
const fmtDate = (s) =>
  parseTs(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function defsFor(svg, uid) {
  const defs = el('defs', {}, svg)
  const sky = el('linearGradient', { id: 'sky' + uid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs)
  ;[['0%', '--ff-sky-top'], ['52%', '--ff-sky-mid'], ['100%', '--ff-sky-hor']].forEach(([o, v]) => {
    el('stop', { offset: o }, sky).style.stopColor = `var(${v})`
  })
  const glow = el('radialGradient', { id: 'glow' + uid }, defs)
  const g1 = el('stop', { offset: '0%' }, glow); g1.style.stopColor = '#FFEAA6'; g1.style.stopOpacity = '.85'
  const g2 = el('stop', { offset: '100%' }, glow); g2.style.stopColor = '#FFEAA6'; g2.style.stopOpacity = '0'
  const mg = el('radialGradient', { id: 'mglow' + uid }, defs)
  const m1 = el('stop', { offset: '0%' }, mg); m1.style.stopColor = '#DCE6C8'; m1.style.stopOpacity = '.3'
  const m2 = el('stop', { offset: '100%' }, mg); m2.style.stopColor = '#DCE6C8'; m2.style.stopOpacity = '0'
  const lg = el('radialGradient', { id: 'lglow' + uid }, defs)
  const l1 = el('stop', { offset: '0%' }, lg); l1.style.stopColor = '#FFD98A'; l1.style.stopOpacity = '.8'
  const l2 = el('stop', { offset: '100%' }, lg); l2.style.stopColor = '#FFD98A'; l2.style.stopOpacity = '0'
  const rough = el('filter', { id: 'rough' + uid, x: '-20%', y: '-20%', width: '140%', height: '140%' }, defs)
  el('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.012 0.024', numOctaves: '2', seed: '7', result: 'n' }, rough)
  el('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: '10' }, rough)
  // Soft edges for MOVING things come from gradients, never filters: a
  // filter on (or under) an animated transform re-rasterizes every frame on
  // the CPU. Filters stay on static scenery only.
  const gc = el('radialGradient', { id: 'gcloud' + uid }, defs)
  const c1 = el('stop', { offset: '0%' }, gc); c1.style.stopColor = '#FDFEF6'; c1.style.stopOpacity = '.75'
  const c2 = el('stop', { offset: '65%' }, gc); c2.style.stopColor = '#FDFEF6'; c2.style.stopOpacity = '.45'
  const c3 = el('stop', { offset: '100%' }, gc); c3.style.stopColor = '#FDFEF6'; c3.style.stopOpacity = '0'
  const gm = el('radialGradient', { id: 'gmist' + uid }, defs)
  const w1 = el('stop', { offset: '0%' }, gm); w1.style.stopColor = '#FFFFFF'; w1.style.stopOpacity = '.7'
  const w2 = el('stop', { offset: '100%' }, gm); w2.style.stopColor = '#FFFFFF'; w2.style.stopOpacity = '0'
  const soft = el('filter', { id: 'soft' + uid, x: '-60%', y: '-60%', width: '220%', height: '220%' }, defs)
  el('feGaussianBlur', { stdDeviation: '7' }, soft)
}

function drawBackdrop(svg, uid, seedOff) {
  el('rect', { x: 0, y: 0, width: 1000, height: 520, fill: `url(#sky${uid})` }, svg)
  const stars = el('g', { opacity: 'var(--ff-stars-o)' }, svg)
  for (let i = 0; i < 40; i++) {
    el('circle', {
      cx: (jitter(i + 300 + seedOff) * 980 + 10).toFixed(0),
      cy: (jitter(i + 500 + seedOff) * 250 + 8).toFixed(0),
      r: (0.7 + jitter(i + 700 + seedOff) * 0.9).toFixed(2),
      fill: '#EDF2E0', opacity: (0.4 + jitter(i + 900 + seedOff) * 0.6).toFixed(2),
    }, stars)
  }
  const sun = el('g', { opacity: 'var(--ff-sun-o)' }, svg)
  el('circle', { cx: 850, cy: 96, r: 110, fill: `url(#glow${uid})` }, sun)
  el('circle', { cx: 850, cy: 96, r: 34, fill: '#F8DC96' }, sun)
  // A full moon with faint maria, and only a tight halo — a big radial glow
  // read as a strange "earth shadow" ring, which real moons don't have.
  const moon = el('g', { opacity: 'var(--ff-moon-o)' }, svg)
  el('circle', { cx: 850, cy: 96, r: 38, fill: `url(#mglow${uid})` }, moon)
  el('circle', { cx: 850, cy: 96, r: 23, fill: '#E9E4CB' }, moon)
  el('circle', { cx: 843, cy: 90, r: 5, fill: '#DAD4B4' }, moon)
  el('circle', { cx: 856, cy: 103, r: 3.5, fill: '#DAD4B4' }, moon)
  el('circle', { cx: 858, cy: 89, r: 2.5, fill: '#DAD4B4' }, moon)
  ;[[170, 100, 64, 0], [520, 66, 48, 1], [730, 140, 55, 2]].forEach((c) => {
    const g = el('g', { class: 'ff-drift', opacity: '.8' }, svg)
    g.style.animationDelay = -c[3] * 30 + 's'
    el('ellipse', { cx: c[0], cy: c[1], rx: c[2] * 1.25, ry: 20, fill: `url(#gcloud${uid})` }, g)
    el('ellipse', { cx: c[0] + 26, cy: c[1] - 10, rx: c[2] * 0.75, ry: 16, fill: `url(#gcloud${uid})` }, g)
  })
  const ridges = el('g', { filter: `url(#rough${uid})` }, svg)
  el('ellipse', { cx: 180, cy: 352, rx: 380, ry: 110, fill: 'var(--ff-ridge-far)', opacity: '.8' }, ridges)
  el('ellipse', { cx: 840, cy: 358, rx: 400, ry: 120, fill: 'var(--ff-ridge-far)', opacity: '.8' }, ridges)
  // A hazy treeline on the far ridges: pure scenery (tiny flat silhouettes,
  // no trunks, no hover) so it can't be mistaken for session trees, but the
  // horizon reads as forest instead of bare lawn.
  const far = el('g', { opacity: '.85' }, svg)
  for (let i = 0; i < 26; i++) {
    const x = 20 + jitter(i + 1000 + seedOff) * 960
    const y = (x < 500 ? hillY(x, 180, 352, 380, 110) : hillY(x, 840, 358, 400, 120)) + 4
    tinyPine(far, x, y, 0.16 + jitter(i + 1100 + seedOff) * 0.1)
  }
  el('ellipse', { cx: 500, cy: 385, rx: 480, ry: 105, fill: 'var(--ff-ridge-mid)' }, ridges)
  const midline = el('g', { opacity: '.75' }, svg)
  for (let i = 0; i < 9; i++) {
    const x = 90 + jitter(i + 1200 + seedOff) * 820
    tinyPine(midline, x, hillY(x, 500, 385, 480, 105) + 5, 0.2 + jitter(i + 1250 + seedOff) * 0.1)
  }
  // Mist as thin wisps hugging the valley line — one tall ellipse read as a
  // giant grey cloud parked over the scene, especially at night.
  const mist = el('g', { class: 'ff-mist', opacity: 'var(--ff-mist-o)' }, svg)
  el('ellipse', { cx: 340, cy: 374, rx: 250, ry: 16, fill: `url(#gmist${uid})` }, mist)
  el('ellipse', { cx: 585, cy: 382, rx: 210, ry: 13, fill: `url(#gmist${uid})`, opacity: '.8' }, mist)
  el('ellipse', { cx: 460, cy: 391, rx: 300, ry: 17, fill: `url(#gmist${uid})`, opacity: '.65' }, mist)
  const ground = el('g', { filter: `url(#rough${uid})` }, svg)
  el('ellipse', { cx: 500, cy: 590, rx: 800, ry: 225, fill: 'var(--ff-ground)' }, ground)
  el('ellipse', { cx: 500, cy: 655, rx: 840, ry: 205, fill: 'var(--ff-ground-front)' }, ground)
  const scrub = el('g', {}, svg)
  for (let i = 0; i < 7; i++) {
    const bx = 40 + jitter(i + 1300 + seedOff) * 920
    const by = hillY(bx, 500, 590, 800, 225) + 30 + jitter(i + 1400 + seedOff) * 70
    const bs = 5 + jitter(i + 1500 + seedOff) * 6
    el('ellipse', { cx: bx.toFixed(0), cy: by.toFixed(0), rx: (bs * 1.7).toFixed(1), ry: bs.toFixed(1), fill: 'var(--ff-bush)', opacity: '.7' }, scrub)
    el('circle', { cx: (bx - bs).toFixed(0), cy: (by - 3).toFixed(0), r: (bs * 0.7).toFixed(1), fill: 'var(--ff-bush)', opacity: '.7' }, scrub)
  }
  for (let i = 0; i < 4; i++) {
    const gx = 60 + jitter(i + 1600 + seedOff) * 880
    const gy = hillY(gx, 500, 655, 840, 205) + 26 + jitter(i + 1700 + seedOff) * 30
    el('ellipse', { cx: gx.toFixed(0), cy: gy.toFixed(0), rx: (5 + jitter(i + 1800 + seedOff) * 5).toFixed(1), ry: 3.6, fill: 'var(--ff-stone)', opacity: '.45' }, scrub)
  }
  const shafts = el('g', { opacity: 'var(--ff-shaft-o)' }, svg)
  el('polygon', { points: '820,90 878,90 700,520 560,520', fill: '#FFF3C4', opacity: '.3', filter: `url(#soft${uid})` }, shafts)
  el('polygon', { points: '860,100 900,104 980,520 850,520', fill: '#FFF3C4', opacity: '.22', filter: `url(#soft${uid})` }, shafts)
  const flowers = el('g', {}, svg)
  for (let i = 0; i < 26; i++) {
    el('circle', {
      cx: (20 + jitter(i + 20 + seedOff) * 960).toFixed(0),
      cy: (392 + jitter(i + 60 + seedOff) * 112).toFixed(0),
      r: (1.5 + jitter(i + 140 + seedOff) * 1.3).toFixed(2),
      fill: 'var(--ff-flower)', opacity: '.9',
    }, flowers)
  }
}

function tinyPine(parent, x, y, s) {
  const g = el('g', { transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` }, parent)
  el('polygon', { points: pts([[-16, 0], [16, 0], [0, -46]], s), fill: 'var(--ff-treeline)' }, g)
  el('polygon', { points: pts([[-11, -24], [11, -24], [0, -62]], s), fill: 'var(--ff-treeline)' }, g)
}

function drawTree(kind, fill, sc, uid, seed = 0) {
  const g = el('g', { class: 'ff-grow' })
  // Per-tree variation, all seeded so it never reshuffles: a nudged hue, a
  // taller or squatter trunk, a slight lean, lobes that wander — no two trees
  // are the same graphic even within a species.
  const v = (k, amt) => 1 + (jitter(seed * 13 + k) - 0.5) * 2 * amt
  const tint = jitter(seed * 13 + 1) > 0.5 ? 'white' : 'black'
  const st = `fill:color-mix(in oklab, ${fill} ${Math.round(90 + jitter(seed * 13 + 2) * 10)}%, ${tint})`
  const th = v(3, 0.18)
  const L = (jitter(seed * 13 + 4) - 0.5) * 4
  if (uid) el('ellipse', { cx: 2 * sc, cy: 1, rx: 18 * sc, ry: 4 * sc, fill: '#000', opacity: 'var(--ff-shad-o)', filter: `url(#soft${uid})` }, g)
  const sway = el('g', { class: 'ff-sway' }, g)
  sway.style.animationDuration = (6 + jitter(seed + 5) * 4).toFixed(2) + 's'
  sway.style.animationDelay = (-jitter(seed + 9) * 8).toFixed(2) + 's'
  // No filter on the tree itself: sway must stay a pure composited transform.
  const inner = el('g', {}, sway)
  const trunkH = (kind === 'other' ? 34 : 19) * th
  el('polygon', {
    points: pts([[-3.6, 0], [3.6, 0], [2.4 + L, -trunkH], [-2.4 + L, -trunkH]], sc),
    fill: kind === 'other' ? 'var(--ff-stone)' : 'var(--ff-trunk)',
  }, inner)
  const lobe = (cx, cy, r, extra) => el('circle', { cx: (cx * sc).toFixed(1), cy: (cy * sc).toFixed(1), r: (r * sc).toFixed(1), ...extra }, inner)
  const hi = { fill: '#fff', opacity: 'var(--ff-hi-o)' }
  const lo = { fill: '#000', opacity: 'var(--ff-lo-o)' }
  if (kind === 'pine') {
    const w = v(5, 0.12), h = v(6, 0.1)
    el('polygon', { points: pts([[-20 * w, -10 * h], [20 * w, -10 * h], [L, -44 * h]], sc), style: st }, inner)
    el('polygon', { points: pts([[-16 * w, -29 * h], [16 * w, -29 * h], [L * 1.3, -58 * h]], sc), style: st }, inner)
    el('polygon', { points: pts([[-10 * w, -46 * h], [10 * w, -46 * h], [L * 1.6, -71 * h]], sc), style: st }, inner)
    el('polygon', { points: pts([[-16 * w, -29 * h], [L * 1.3, -29 * h], [L * 1.3, -58 * h]], sc), ...hi }, inner)
  } else if (kind === 'cypress') {
    const w = v(5, 0.14), h = v(6, 0.12)
    el('ellipse', { cx: L * sc, cy: -34 * h * sc, rx: 10 * w * sc, ry: 26 * h * sc, style: st }, inner)
    el('ellipse', { cx: L * 1.4 * sc, cy: -56 * h * sc, rx: 5.5 * w * sc, ry: 12 * h * sc, style: st }, inner)
    el('ellipse', { cx: (L - 3) * sc, cy: -42 * h * sc, rx: 4 * sc, ry: 14 * h * sc, ...hi }, inner)
    el('ellipse', { cx: (L + 4) * sc, cy: -26 * h * sc, rx: 4 * sc, ry: 12 * h * sc, ...lo }, inner)
  } else if (kind === 'other') {
    // Birch: a tall pale trunk with a small, high, airy crown — nothing like
    // the broad round canopies, so an uncategorized session reads at a glance.
    const top = -trunkH
    lobe(L, top - 6 * v(7, 0.2), 9 * v(8, 0.15), { style: st })
    lobe(L - 7 * v(9, 0.3), top + 2, 6.5 * v(10, 0.2), { style: st })
    lobe(L + 7 * v(11, 0.3), top - 1, 6 * v(12, 0.2), { style: st })
    lobe(L - 2, top - 9, 3.5, hi)
  } else if (kind === 'leaf') {
    const w = v(5, 0.12)
    lobe(L, -40 * th, 23 * w, { style: st })
    lobe(L - 13 * v(7, 0.25), -29 * th, 13 * v(8, 0.2), { style: st })
    lobe(L + 13 * v(9, 0.25), -29 * th, 13 * v(10, 0.2), { style: st })
    if (jitter(seed * 13 + 11) > 0.45) lobe(L + (jitter(seed * 13 + 12) - 0.5) * 20, -52 * th, 8 * v(13, 0.3), { style: st })
    lobe(L - 8, -47 * th, 10, hi)
    lobe(L + 10, -30 * th, 9, lo)
  } else if (kind === 'maple') {
    const w = v(5, 0.15)
    lobe(L - 13 * v(7, 0.25), -31 * th, 14 * w, { style: st })
    lobe(L + 13 * v(8, 0.25), -31 * th, 14 * w, { style: st })
    lobe(L, -46 * th, 17 * v(9, 0.12), { style: st })
    if (jitter(seed * 13 + 10) > 0.5) lobe(L + (jitter(seed * 13 + 11) - 0.5) * 24, -40 * th, 9, { style: st })
    lobe(L - 6, -50 * th, 8, hi)
    lobe(L + 11, -29 * th, 8, lo)
  } else {
    const w = v(5, 0.15)
    el('ellipse', { cx: L * sc, cy: -27 * th * sc, rx: 20 * w * sc, ry: 15 * v(6, 0.15) * sc, style: st }, inner)
    lobe(L - 11 * v(7, 0.3), -36 * th, 7 * v(8, 0.25), { style: st })
    lobe(L + 11 * v(9, 0.3), -33 * th, 6 * v(10, 0.25), { style: st })
    if (jitter(seed * 13 + 11) > 0.5) lobe(L + (jitter(seed * 13 + 12) - 0.5) * 16, -40 * th, 5, { style: st })
    lobe(L - 6, -33 * th, 6, hi)
    lobe(L + 9, -23 * th, 6, lo)
  }
  return g
}

function drawLandmark(svg, uid, id, x, y) {
  const g = el('g', { transform: `translate(${x},${y})` }, svg)
  if (id === 'pond') {
    const p = el('g', { filter: `url(#rough${uid})` }, g)
    el('ellipse', { cx: 0, cy: 0, rx: 74, ry: 20, fill: 'var(--ff-pond)' }, p)
    el('ellipse', { cx: -14, cy: -3, rx: 34, ry: 8, fill: 'var(--ff-pond-hi)', opacity: '.55' }, p)
    ;[[-78, -6], [-66, -14], [80, -4]].forEach((r) => {
      el('polygon', { points: `${r[0]},${r[1]} ${r[0] + 2},${r[1] - 16} ${r[0] + 4},${r[1]}`, fill: 'var(--ff-pine-1)' }, g)
    })
  } else if (id === 'lantern') {
    el('circle', { cx: 0, cy: -22, r: 30, fill: `url(#lglow${uid})`, opacity: 'var(--ff-lantern-glow)' }, g)
    el('rect', { x: -9, y: -6, width: 18, height: 6, rx: 2, fill: 'var(--ff-stone)' }, g)
    el('rect', { x: -4, y: -18, width: 8, height: 12, fill: 'var(--ff-stone)' }, g)
    el('rect', { x: -11, y: -26, width: 22, height: 8, rx: 3, fill: 'var(--ff-stone)' }, g)
    el('rect', { x: -6, y: -33, width: 12, height: 7, rx: 2, fill: 'var(--ff-stone)' }, g)
    el('circle', { cx: 0, cy: -22, r: 3, fill: '#FFD98A' }, g)
  } else if (id === 'bench') {
    el('rect', { x: -20, y: -12, width: 40, height: 4, rx: 2, fill: 'var(--ff-wood)' }, g)
    el('rect', { x: -20, y: -22, width: 40, height: 4, rx: 2, fill: 'var(--ff-wood)' }, g)
    el('rect', { x: -16, y: -12, width: 4, height: 12, fill: 'var(--ff-wood)' }, g)
    el('rect', { x: 12, y: -12, width: 4, height: 12, fill: 'var(--ff-wood)' }, g)
  } else if (id === 'cabin') {
    el('polygon', { points: '-26,-24 26,-24 0,-46', fill: 'var(--ff-wood)' }, g)
    el('rect', { x: -20, y: -24, width: 40, height: 24, fill: 'var(--ff-stone)' }, g)
    el('rect', { x: -6, y: -14, width: 12, height: 14, fill: 'var(--ff-wood)' }, g)
    el('circle', { cx: 12, cy: -18, r: 4, fill: '#FFD98A', opacity: 'var(--ff-lantern-glow)' }, g)
  } else if (id === 'falls') {
    el('rect', { x: -8, y: -52, width: 16, height: 40, rx: 5, fill: 'var(--ff-pond-hi)', opacity: '.8' }, g)
    el('ellipse', { cx: 0, cy: -6, rx: 26, ry: 9, fill: 'var(--ff-pond)' }, g)
  }
}

// Tooltip content is built with textContent (never innerHTML): intention text
// is user data.
// What a session was: the category the intention gate declared at the start,
// or — for sessions from before the gate — the one the monitor observed most.
const sessionCategory = (s) => s.llm_category || s.top_category || null

function fillTip(tip, s, kind, extra = 0) {
  tip.replaceChildren()
  const t = document.createElement('p'); t.className = 'ff-tip-t'
  const dot = document.createElement('span'); dot.className = 'ff-tip-dot'
  dot.style.background = `var(--ff-${kind}-1)`
  t.appendChild(dot); t.appendChild(document.createTextNode(s.text))
  const m1 = document.createElement('p'); m1.className = 'ff-tip-m'
  const declared = s.llm_category, seen = s.top_category
  const pct = s.top_share != null ? `${Math.round(s.top_share * 100)}%` : ''
  let cat
  if (declared && seen && declared !== seen) cat = `${declared} · mostly ${seen}${pct ? ` (${pct})` : ''}`
  else if (declared) cat = declared
  else if (seen) cat = `${seen}${pct ? ` (${pct} of the session)` : ''}`
  else cat = 'Uncategorized'
  m1.textContent = `${cat} · ${fmtDate(s.started_at)}`
  const m2 = document.createElement('p'); m2.className = 'ff-tip-m'
  const alignTxt = s.avg_align == null ? 'ALIGN —' : `ALIGN ${Math.round(s.avg_align * 100)}%`
  m2.textContent = `${durationMin(s)} min · ${alignTxt}${extra ? ` · grove of ${extra + 1}` : ''}`
  tip.append(t, m1, m2)
}

// Groves that already played their grow-in this page load render instantly on
// remount/rerender — the stagger replays only the first time a grove (at a
// given tree count) appears, so tab switches and swipes stop "popping" trees.
const grownGroves = new Set()

// Landmark anchors: x, y, and a keep-clear radius the trees respect.
const LANDMARK_SPOTS = { pond: [190, 492, 80], lantern: [880, 487, 36], bench: [115, 483, 40], cabin: [848, 408, 50], falls: [125, 404, 46] }

function renderGroveSvg(svg, tip, sessions, uid, seedOff, earnedHere, groveKey, durCap) {
  svg.replaceChildren()
  defsFor(svg, uid)
  drawBackdrop(svg, uid, seedOff)
  earnedHere.forEach((id) => { const [x, y] = LANDMARK_SPOTS[id] || [500, 470]; drawLandmark(svg, uid, id, x, y) })
  const stamp = `${groveKey}:${sessions.length}`
  const replay = !grownGroves.has(stamp)
  grownGroves.add(stamp)

  // A scattered stand, not rows. Each session tries a handful of seeded
  // candidate points on the hillside and keeps the one farthest from every
  // tree (and landmark) already placed. Depth follows y — higher on the slope
  // is farther away, so smaller and drawn first — and a session's age nudges
  // its depth, so a month's earliest work stands toward the back.
  const yTop = (x) => hillY(x, 500, 385, 480, 105) + 8
  const yBot = (x) => hillY(x, 500, 655, 840, 205) + 20
  const N = sessions.length
  const placed = earnedHere.map((id) => { const [x, y, r] = LANDMARK_SPOTS[id] || [500, 470, 40]; return { x, y, r } })
  const entries = sessions.map((s, i) => {
    const mins = durationMin(s)
    // How well the session went counts as much as how long it ran: a clean
    // 30-minute sprint stands as tall as an hour of drifting.
    const quality = s.avg_align == null ? 0.5 : Math.max(0, Math.min(1, (s.avg_align - 0.5) / 0.45))
    // Sparse months keep their trees toward the front rather than stranding
    // a single session small on the back slope.
    const tmin = Math.max(0, 0.5 - N * 0.05)
    const target = N > 1 ? tmin + (1 - tmin) * (i / (N - 1)) : 0.85
    let best = null
    for (let k = 0; k < 24; k++) {
      const x = 50 + jitter(seedOff * 7 + i * 53 + k * 11 + 1) * 900
      const t = Math.max(0, Math.min(1, target + (jitter(seedOff * 7 + i * 53 + k * 11 + 2) - 0.5) * 0.7))
      const top = yTop(x), bot = yBot(x)
      const y = top + (bot - top) * t
      // Duration is relative to the user's own longest sessions, so a forest
      // of 30-60 minute sits still shows real variety.
      const size = (0.6 + 0.4 * t) * (0.7 + (Math.min(mins, durCap) / durCap) * 0.4 + quality * 0.4)
      const r = 24 * size
      let gap = Infinity
      for (const p of placed) gap = Math.min(gap, Math.hypot(p.x - x, (p.y - y) * 1.6) - (p.r + r))
      if (best === null || gap > best.gap) best = { x, y, size, r, gap }
      if (gap > 10) break
    }
    placed.push({ x: best.x, y: best.y, r: best.r })
    return { s, gi: i, mins, x: best.x, y: best.y, size: best.size }
  })
  entries.sort((a, b) => a.y - b.y)

  entries.forEach(({ s, gi, mins, x, y, size }, rank) => {
    const sc = size * (0.92 + jitter(gi + seedOff + 7) * 0.16)
    const sp = speciesFor(sessionCategory(s))
    const fill = foliageFill(sp.kind, s.avg_align)
    // Longer and cleaner sessions grow into groves: companion saplings of the
    // same species gather around the main tree. Purely additive — a short or
    // drifting session is still a whole tree.
    const extra = Math.min(3, Math.max(0, Math.floor(mins / 30) - 1 + (s.avg_align != null && s.avg_align >= 0.85 ? 1 : 0)))
    const t = el('g', {
      class: 'ff-tree', transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, tabindex: '0',
      'aria-label': `${s.text}, ${sp.label}, ${mins} minutes${extra ? `, grove of ${extra + 1}` : ''}`,
    }, svg)
    const parts = []
    for (let c = 0; c < extra; c++) {
      const a = jitter(gi * 17 + c * 5 + seedOff) * Math.PI * 2
      const dist = (16 + jitter(gi * 17 + c * 5 + seedOff + 1) * 16) * sc
      const dx = Math.cos(a) * dist, dy = Math.sin(a) * dist * 0.45
      const csc = sc * (0.42 + jitter(gi * 17 + c * 5 + seedOff + 2) * 0.22)
      const wrap = el('g', { transform: `translate(${dx.toFixed(1)},${dy.toFixed(1)})` })
      wrap.appendChild(drawTree(sp.kind, fill, csc, uid, gi * 100 + c + 1 + seedOff))
      parts.push({ dy, node: wrap })
    }
    parts.push({ dy: 0, node: drawTree(sp.kind, fill, sc, uid, gi + seedOff) })
    parts.sort((a, b) => a.dy - b.dy)
    parts.forEach((part) => t.appendChild(part.node))
    const show = () => {
      fillTip(tip, s, sp.kind, extra)
      tip.style.display = 'block'
      const r = svg.getBoundingClientRect()
      const px = (x / 1000) * r.width, py = (y / 520) * r.height
      tip.style.left = Math.min(Math.max(px - 100, 8), r.width - 260) + 'px'
      tip.style.top = Math.max(py - 128, 8) + 'px'
    }
    const hide = () => { tip.style.display = 'none' }
    t.addEventListener('pointerenter', show)
    t.addEventListener('focus', show)
    t.addEventListener('pointerleave', hide)
    t.addEventListener('blur', hide)
    const grows = t.querySelectorAll('.ff-grow')
    if (replay) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        grows.forEach((gEl, n) => {
          gEl.style.transitionDelay = Math.min(rank * 30 + n * 90, 1200) + 'ms'
          gEl.classList.add('in')
        })
      }))
    } else {
      grows.forEach((gEl) => gEl.classList.add('ff-instant', 'in'))
    }
  })
  el('ellipse', { cx: 500, cy: 600, rx: 860, ry: 110, fill: 'var(--ff-fg-band)', opacity: '.85', filter: `url(#rough${uid})` }, svg)
}

// A data-derived personal line for a grove. In time these could come from the
// model that already scores the sessions — for now they are honest arithmetic.
function whisper(idx, keys, byMonth) {
  const key = keys[idx]
  const data = byMonth.get(key)
  if (!data?.length) return ''
  if (data.length === 1) {
    const only = data[0]
    const al = only.avg_align != null ? ` at ${Math.round(only.avg_align * 100)}% align` : ''
    return `“${only.text}” — ${durationMin(only)} minutes${al}.`
  }
  const longest = data.reduce((a, s) => (durationMin(s) > durationMin(a) ? s : a), data[0])
  const scored = data.filter((s) => s.avg_align != null)
  const cleanest = scored.length ? scored.reduce((a, s) => (s.avg_align > a.avg_align ? s : a), scored[0]) : null
  const hrs = data.reduce((a, s) => a + durationMin(s), 0) / 60
  const prev = idx > 0 ? byMonth.get(keys[idx - 1]) : null
  const prevHrs = prev ? prev.reduce((a, s) => a + durationMin(s), 0) / 60 : 0
  const options = [
    `Your longest sit here: ${durationMin(longest)} minutes on “${longest.text}.”`,
    cleanest
      ? `“${cleanest.text}” ran at ${Math.round(cleanest.avg_align * 100)}% align — your cleanest hour of the month.`
      : `The tallest tree here grew from “${longest.text}.”`,
    prev && hrs > prevHrs
      ? `${(hrs - prevHrs).toFixed(1)} hours deeper than ${monthLabel(keys[idx - 1]).split(' ')[0]}. The grove is thickening.`
      : `The tallest tree here grew from “${longest.text}.”`,
  ]
  return options[idx % options.length]
}

function computeMilestones(sessions) {
  const sorted = [...sessions].sort((a, b) => (a.started_at < b.started_at ? -1 : 1))
  let count = 0, hours = 0
  const earned = {}
  for (const s of sorted) {
    count++; hours += durationMin(s) / 60
    for (const m of MILESTONES) {
      if (!earned[m.id] && m.test({ count, hours })) {
        earned[m.id] = { date: s.started_at, month: monthKey(s) }
      }
    }
  }
  return { earned, count, hours }
}

function bestStreak(sessions) {
  const days = [...new Set(sessions.map((s) => String(s.started_at).slice(0, 10)))].sort()
  let best = 0, run = 0, prev = null
  for (const d of days) {
    run = prev && parseTs(d + ' 00:00:00') - parseTs(prev + ' 00:00:00') === 86400000 ? run + 1 : 1
    best = Math.max(best, run); prev = d
  }
  return best
}

function Mini({ kind, align = 0.88, sc, w, h }) {
  const ref = useRef(null)
  useEffect(() => {
    const s = ref.current
    s.replaceChildren()
    const g = drawTree(kind, foliageFill(kind, align), sc, null)
    g.classList.add('in'); g.style.transition = 'none'
    g.querySelector('.ff-sway').style.animation = 'none'
    const wrap = el('g', { transform: 'translate(0,-2)' }, s)
    wrap.appendChild(g)
  }, [kind, align, sc])
  return <svg ref={ref} viewBox={`${-w / 2} ${-h} ${w} ${h}`} width={w} height={h} aria-hidden="true" style={{ display: 'block' }} />
}

const fmtMin = (m) => (m >= 60 ? (m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} m`) : `${m} min`)

const MILE_ICONS = {
  pond: (
    <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true">
      <ellipse cx="13" cy="11" rx="11" ry="5" fill="var(--ff-pond)" />
      <ellipse cx="10" cy="10" rx="5" ry="1.8" fill="var(--ff-pond-hi)" />
    </svg>
  ),
  lantern: (
    <svg width="16" height="22" viewBox="0 0 16 22" aria-hidden="true">
      <rect x="3" y="16" width="10" height="3" rx="1" fill="var(--ff-stone)" />
      <rect x="6" y="9" width="4" height="7" fill="var(--ff-stone)" />
      <rect x="2" y="5" width="12" height="4" rx="1.5" fill="var(--ff-stone)" />
      <rect x="5" y="1" width="6" height="4" rx="1" fill="var(--ff-stone)" />
      <circle cx="8" cy="7" r="1.6" fill="#FFD98A" />
    </svg>
  ),
  bench: (
    <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true">
      <rect x="2" y="3" width="20" height="2.6" rx="1" fill="var(--ff-wood)" />
      <rect x="2" y="8" width="20" height="2.6" rx="1" fill="var(--ff-wood)" />
      <rect x="4" y="8" width="2.4" height="7" fill="var(--ff-wood)" />
      <rect x="17.6" y="8" width="2.4" height="7" fill="var(--ff-wood)" />
    </svg>
  ),
  cabin: (
    <svg width="22" height="20" viewBox="0 0 22 20" aria-hidden="true">
      <polygon points="11,1 21,9 1,9" fill="var(--ff-wood)" />
      <rect x="4" y="9" width="14" height="9" fill="var(--ff-stone)" />
      <rect x="9" y="12" width="4" height="6" fill="var(--ff-wood)" />
    </svg>
  ),
  falls: (
    <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true">
      <rect x="6" y="1" width="6" height="13" rx="2" fill="var(--ff-pond-hi)" />
      <ellipse cx="9" cy="16" rx="8" ry="3.4" fill="var(--ff-pond)" />
    </svg>
  ),
}

// Ambient life per grove: fireflies at night, drifting petals and a bird by
// day. Plain HTML spans over the SVG — GPU-composited, so none of it re-runs
// the painterly filters. Deterministic per grove, so re-renders don't reshuffle.
function ambientSpans(idx) {
  const out = []
  for (let i = 0; i < 6; i++) {
    out.push({ t: 'fly', left: 8 + jitter(idx * 31 + i + 40) * 84, top: 46 + jitter(idx * 31 + i + 80) * 34, delay: jitter(idx * 31 + i + 120) * 4, dur: 3.4 + jitter(idx * 31 + i + 160) * 2.4 })
  }
  for (let i = 0; i < 6; i++) {
    out.push({ t: 'petal', left: 5 + jitter(idx * 47 + i + 200) * 90, delay: -jitter(idx * 47 + i + 240) * 16, dur: 13 + jitter(idx * 47 + i + 280) * 7, pink: i % 2 === 0 })
  }
  return out
}

function Grove({ monthKey: key, sessions, idx, earnedHere, whisperText, durCap }) {
  const svgRef = useRef(null)
  const tipRef = useRef(null)
  const sectionRef = useRef(null)
  useEffect(() => {
    renderGroveSvg(svgRef.current, tipRef.current, sessions, 'g' + idx, idx * 57, earnedHere, key, durCap)
  }, [sessions, idx, earnedHere, key, durCap])
  // Only the grove actually on screen animates — sway, drift, mist, and the
  // ambient layer all pause in the other groves (and while scrolled away).
  useEffect(() => {
    const node = sectionRef.current
    const io = new IntersectionObserver(
      ([e]) => node.classList.toggle('ff-live', e.intersectionRatio >= 0.5),
      { threshold: [0, 0.5, 1] },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [])
  const hrs = sessions.reduce((a, s) => a + durationMin(s), 0) / 60
  const scored = sessions.filter((s) => s.avg_align != null)
  const avg = scored.length
    ? Math.round((scored.reduce((a, s) => a + s.avg_align, 0) / scored.length) * 100)
    : null
  return (
    <section ref={sectionRef} className={`ff-grove ${seasonClass(key)}`} data-key={key}>
      <div className="relative">
        <svg ref={svgRef} viewBox="0 0 1000 520" role="img" aria-label={`The ${monthLabel(key)} grove`} />
        <div className="ff-ambient" aria-hidden="true">
          {ambientSpans(idx).map((a, i) => a.t === 'fly'
            ? <span key={i} className="ff-fly" style={{ left: `${a.left}%`, top: `${a.top}%`, animationDelay: `${a.delay.toFixed(2)}s`, animationDuration: `${a.dur.toFixed(2)}s` }} />
            : <span key={i} className="ff-petal" style={{ left: `${a.left}%`, animationDelay: `${a.delay.toFixed(2)}s`, animationDuration: `${a.dur.toFixed(2)}s`, background: a.pink ? 'var(--ff-cherry-0)' : 'var(--ff-leaf-0)' }} />)}
          <span className="ff-bird" style={{ animationDelay: `${-(idx * 13)}s` }}>
            <svg width="20" height="9" viewBox="0 0 20 9"><path d="M1 7 Q5.5 1 10 6 Q14.5 1 19 7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
          </span>
        </div>
        <div ref={tipRef} className="ff-tip" />
      </div>
      <div className="px-5 py-4">
        <div className="flex justify-between items-baseline gap-3 flex-wrap">
          <span className="text-lg font-semibold text-slate-800 dark:text-slate-100">{monthLabel(key)}</span>
          <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">
            {sessions.length} trees · {hrs.toFixed(1)} h{avg != null ? ` · ${avg}% align` : ''}
          </span>
        </div>
        {whisperText && (
          <p className="mt-1 text-[15px] italic font-serif text-slate-500 dark:text-slate-400">{whisperText}</p>
        )}
      </div>
    </section>
  )
}

export default function ForestPanel() {
  const [sessions, setSessions] = useState(null)
  const [error, setError] = useState(null)
  const scrollerRef = useRef(null)
  const [activeKey, setActiveKey] = useState(null)
  const lastJson = useRef('')

  useEffect(() => {
    let alive = true
    // Only adopt a poll result that actually changed — a fresh-but-identical
    // array every 60s would re-render every grove for nothing.
    const load = () =>
      fetchSessions()
        .then((rows) => {
          if (!alive) return
          const j = JSON.stringify(rows)
          if (j !== lastJson.current) { lastJson.current = j; setSessions(rows) }
          setError(null)
        })
        .catch((e) => { if (alive) setError(e.message) })
    load()
    const id = setInterval(load, 60000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const { keys, byMonth, milestones, earnedByMonth, durCap, sizeLegend, speciesLegend } = useMemo(() => {
    const rows = (sessions || []).filter((s) => s.started_at && s.ended_at)
    rows.sort((a, b) => (a.started_at < b.started_at ? -1 : 1))
    const byMonth = new Map()
    for (const s of rows) {
      const k = monthKey(s)
      if (!byMonth.has(k)) byMonth.set(k, [])
      byMonth.get(k).push(s)
    }
    const milestones = computeMilestones(rows)
    // Landmark ids per grove, built HERE so each grove's array keeps a stable
    // identity across re-renders — a fresh array per render made the grove
    // effect refire (and the trees replay their grow-in) on every scroll tick.
    const earnedByMonth = new Map()
    for (const m of MILESTONES) {
      const e = milestones.earned[m.id]
      if (!e) continue
      if (!earnedByMonth.has(e.month)) earnedByMonth.set(e.month, [])
      earnedByMonth.get(e.month).push(m.id)
    }
    // Legends come from what the data actually holds: the categories that
    // occur (most frequent first) and this forest's own duration spread.
    const durations = rows.map(durationMin).filter((m) => m > 0).sort((a, b) => a - b)
    const durCap = Math.max(60, durations[durations.length - 1] || 60)
    const sizeLegend = durations.length
      ? [...new Set([durations[0], durations[Math.floor(durations.length / 2)], durations[durations.length - 1]])]
      : [30, 45, 60]
    const catCounts = new Map()
    for (const s of rows) {
      const label = speciesFor(sessionCategory(s)).label
      catCounts.set(label, (catCounts.get(label) || 0) + 1)
    }
    const speciesLegend = [...catCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => ({ label, kind: speciesFor(label === 'Uncategorized' ? null : label).kind }))
    return { keys: [...byMonth.keys()], byMonth, milestones, earnedByMonth, durCap, sizeLegend, speciesLegend }
  }, [sessions])

  // Open on the newest grove, and keep the month chips in sync with scrolling.
  useEffect(() => {
    const sc = scrollerRef.current
    if (!sc || !keys.length) return
    const last = sc.querySelector(`[data-key="${keys[keys.length - 1]}"]`)
    last?.scrollIntoView({ inline: 'center', block: 'nearest' })
    const mark = () => {
      const mid = sc.scrollLeft + sc.clientWidth / 2
      let bestKey = keys[0], bestDist = Infinity
      sc.querySelectorAll('.ff-grove').forEach((s) => {
        const d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - mid)
        if (d < bestDist) { bestDist = d; bestKey = s.dataset.key }
      })
      setActiveKey(bestKey)
    }
    mark()
    const onScroll = () => requestAnimationFrame(mark)
    sc.addEventListener('scroll', onScroll)
    return () => sc.removeEventListener('scroll', onScroll)
  }, [keys])

  const jumpTo = (key) => {
    scrollerRef.current
      ?.querySelector(`[data-key="${key}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Forest</h2>
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    )
  }
  if (sessions === null) {
    return <p className="text-slate-500 dark:text-slate-400">Growing the forest…</p>
  }
  if (!keys.length) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-8 rounded-lg shadow-md text-center">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">The field is waiting</h2>
        <p className="text-slate-500 dark:text-slate-400">
          Declare an intention and finish the session — the first tree takes root the moment it ends.
        </p>
      </div>
    )
  }

  const all = keys.flatMap((k) => byMonth.get(k))
  const totalHrs = all.reduce((a, s) => a + durationMin(s), 0) / 60
  const scored = all.filter((s) => s.avg_align != null)
  const avgAlign = scored.length
    ? Math.round((scored.reduce((a, s) => a + s.avg_align, 0) / scored.length) * 100)
    : null
  const firstDate = fmtDate(all[0].started_at)

  const stats = [
    { k: 'Sessions standing', v: all.length, u: 'each a tree or a grove' },
    { k: 'Focused hours', v: totalHrs.toFixed(1), u: 'inside sessions' },
    { k: 'Avg align', v: avgAlign != null ? `${avgAlign}%` : '—', u: 'time on intention' },
    { k: 'Best streak', v: bestStreak(all), u: 'days in a row' },
  ]

  return (
    <div className="ff-root">
      <style>{FOREST_CSS}</style>

      <p className="mb-4 text-[15px] italic font-serif text-slate-500 dark:text-slate-400">
        {all.length} sessions since {firstDate} — every one of them is still standing.
      </p>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4 mb-5">
        {stats.map((s) => (
          <div key={s.k} className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-lg shadow-md px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500">{s.k}</p>
            <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{s.v}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{s.u}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => jumpTo(k)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              activeKey === k
                ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {monthLabel(k)}
          </button>
        ))}
      </div>

      <div ref={scrollerRef} className="ff-scroller">
        {keys.map((k, i) => (
          <Grove
            key={k}
            monthKey={k}
            sessions={byMonth.get(k)}
            idx={i}
            earnedHere={earnedByMonth.get(k) || EMPTY}
            whisperText={whisper(i, keys, byMonth)}
            durCap={durCap}
          />
        ))}
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3">
          The land remembers
        </h2>
        <div className="flex gap-3 flex-wrap">
          {MILESTONES.map((m) => {
            const e = milestones.earned[m.id]
            return (
              <div key={m.id} className={`flex items-center gap-3 bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-lg shadow-md px-4 py-3 text-sm ${e ? '' : 'opacity-75'}`}>
                {MILE_ICONS[m.id]}
                <span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{m.name}</span>
                  <br />
                  <span className="text-slate-500 dark:text-slate-400">
                    {e ? `${m.what} · appeared ${fmtDate(e.date)}` : m.left ? m.left(milestones) : m.what}
                  </span>
                </span>
                {!e && m.pct && (
                  <span className="w-20 h-1.5 rounded bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <i className="block h-full bg-emerald-500 rounded" style={{ width: `${Math.min(m.pct(milestones), 100).toFixed(0)}%` }} />
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-3 mt-6 items-stretch">
        <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-lg shadow-md p-5 flex flex-col">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 mb-3">Species is the category</p>
          <div className="flex items-end justify-around gap-2 flex-wrap grow">
            {speciesLegend.map(({ label, kind }) => (
              <div key={label} className="flex flex-col items-center justify-end gap-1 text-xs text-slate-500 dark:text-slate-400 min-w-[64px]">
                <Mini kind={kind} sc={0.5} w={48} h={42} />
                <span className="text-center leading-tight">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-lg shadow-md p-5 flex flex-col">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 mb-3">Size is duration and align</p>
          <div className="flex items-end justify-around gap-2 grow">
            {sizeLegend.map((mins) => (
              <div key={mins} className="flex flex-col items-center justify-end gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Mini kind="leaf" align={0.8} sc={0.28 + (mins / durCap) * 0.38} w={56} h={50} />
                <span>{fmtMin(mins)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">Scaled to your own sessions; a clean session stands taller than its minutes alone. Longer and cleaner sessions grow into groves.</p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-lg shadow-md p-5 flex flex-col">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 mb-3">Lushness is the align score</p>
          <div className="grow flex flex-col justify-end">
            <div className="h-3 rounded-full" style={{ background: 'linear-gradient(to right, var(--ff-leaf-0), var(--ff-leaf-1), var(--ff-leaf-2))' }} />
            <div className="flex justify-between mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span>50% align</span>
              <span>95%+</span>
            </div>
            <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">Foliage deepens continuously with time on intention.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// All scene color comes from these variables, so the dashboard's .dark class
// turns every grove to night without touching the SVG. Season classes only
// re-tint daylight; night is night in every season.
const FOREST_CSS = `
.ff-root{
  --ff-sun-o:1; --ff-moon-o:0; --ff-stars-o:0; --ff-shaft-o:.5; --ff-mist-o:.5;
  --ff-hi-o:.2; --ff-lo-o:.12; --ff-shad-o:.14; --ff-lantern-glow:.25;
  --ff-fly-o:0; --ff-petal-o:1;
  --ff-treeline:#7FA073; --ff-bush:#7E9B63;
  --ff-trunk:#6E5843; --ff-fg-band:#6E9451;
  --ff-pond:#8FBECB; --ff-pond-hi:#C9E4E4; --ff-stone:#B9B3A2; --ff-wood:#8A6B4C;
  --ff-pine-0:#9CC4AE; --ff-pine-1:#5E9C7C; --ff-pine-2:#2F7256;
  --ff-leaf-0:#CCDF96; --ff-leaf-1:#8FB756; --ff-leaf-2:#5F8F2E;
  --ff-maple-0:#E9C48A; --ff-maple-1:#D69A4B; --ff-maple-2:#B26F1F;
  --ff-cherry-0:#EFC3D2; --ff-cherry-1:#DE8FAC; --ff-cherry-2:#C25E85;
  --ff-cypress-0:#A8C6C0; --ff-cypress-1:#6FA098; --ff-cypress-2:#45766E;
  --ff-other-0:#C2CDB2; --ff-other-1:#93A57F; --ff-other-2:#6A7F58;
}
.ff-grove.ff-spring{--ff-sky-top:#9FC6C2; --ff-sky-mid:#C8E0C3; --ff-sky-hor:#EEE8C2; --ff-ridge-far:#A6C2AE; --ff-ridge-mid:#79A47E; --ff-ground:#84B173; --ff-ground-front:#6FA061; --ff-flower:#F3CBD6}
.ff-grove.ff-summer{--ff-sky-top:#98BFAE; --ff-sky-mid:#C6DDB9; --ff-sky-hor:#F2E1AC; --ff-ridge-far:#9CBAA0; --ff-ridge-mid:#76A06F; --ff-ground:#86AC62; --ff-ground-front:#739C52; --ff-flower:#FBF3D9}
.ff-grove.ff-autumn{--ff-sky-top:#AFBCA4; --ff-sky-mid:#D6D3A8; --ff-sky-hor:#F0CE8E; --ff-ridge-far:#ADB794; --ff-ridge-mid:#8C9C64; --ff-ground:#A89B5A; --ff-ground-front:#93884C; --ff-flower:#E8B87E}
.ff-grove.ff-winter{--ff-sky-top:#B7C7CD; --ff-sky-mid:#D7E0DC; --ff-sky-hor:#EFEBDD; --ff-ridge-far:#B4C3B4; --ff-ridge-mid:#93A995; --ff-ground:#A9BFA2; --ff-ground-front:#97AF90; --ff-flower:#F5F7F1}
.dark .ff-root{
  --ff-sun-o:0; --ff-moon-o:1; --ff-stars-o:.9; --ff-shaft-o:0; --ff-mist-o:.08;
  --ff-hi-o:.08; --ff-lo-o:.2; --ff-shad-o:.32; --ff-lantern-glow:1;
  --ff-fly-o:1; --ff-petal-o:0;
  --ff-treeline:#1D2D22; --ff-bush:#20301C;
  --ff-trunk:#55483A; --ff-fg-band:#141F0E;
  --ff-pond:#2A4A54; --ff-pond-hi:#476E74; --ff-stone:#4A473E; --ff-wood:#5B4632;
  --ff-pine-0:#48604F; --ff-pine-1:#528568; --ff-pine-2:#64B189;
  --ff-leaf-0:#5C6C41; --ff-leaf-1:#7E9E4C; --ff-leaf-2:#A0C75E;
  --ff-maple-0:#7C6337; --ff-maple-1:#A8823D; --ff-maple-2:#D4A64C;
  --ff-cherry-0:#6F4B58; --ff-cherry-1:#9E617B; --ff-cherry-2:#CC7C9E;
  --ff-cypress-0:#3E5652; --ff-cypress-1:#4F7B73; --ff-cypress-2:#68A399;
  --ff-other-0:#4C5643; --ff-other-1:#67775A; --ff-other-2:#8AA07A;
}
.dark .ff-root .ff-grove{
  --ff-sky-top:#0F1926; --ff-sky-mid:#132320; --ff-sky-hor:#25331F;
  --ff-ridge-far:#1B2A24; --ff-ridge-mid:#1F3020; --ff-ground:#25361E;
  --ff-ground-front:#1E2D18; --ff-flower:#394430;
}
.ff-scroller{display:flex; gap:20px; overflow-x:auto; scroll-snap-type:x mandatory; padding:4px 4px 8px; scrollbar-width:none}
.ff-scroller::-webkit-scrollbar{display:none}
.ff-grove{flex:0 0 min(92%,860px); scroll-snap-align:center; border-radius:16px; overflow:hidden; position:relative;
  background:#fff; box-shadow:0 4px 6px -1px rgb(0 0 0/.1),0 2px 4px -2px rgb(0 0 0/.1)}
.dark .ff-grove{background:#0f172a; border:1px solid #1e293b}
.ff-grove svg{display:block; width:100%; height:auto}
.ff-tree{cursor:pointer}
.ff-tree:focus-visible{outline:none}
.ff-tree:hover .ff-grow,.ff-tree:focus-visible .ff-grow{filter:brightness(1.08) saturate(1.06)}
.ff-grow{transform-box:fill-box; transform-origin:50% 100%; transform:scale(0)}
.ff-grow.in{transform:scale(1); transition:transform .6s cubic-bezier(.34,1.5,.64,1)}
.ff-grow.ff-instant{transition:none}
.ff-sway{transform-box:fill-box; transform-origin:50% 100%; animation:ff-sway 7s ease-in-out infinite alternate}
.ff-sway,.ff-drift,.ff-mist,.ff-ambient span{animation-play-state:paused}
.ff-live .ff-sway,.ff-live .ff-drift,.ff-live .ff-mist,.ff-live .ff-ambient span{animation-play-state:running}
@keyframes ff-sway{from{transform:rotate(-.6deg)}to{transform:rotate(.6deg)}}
.ff-drift{animation:ff-drift 90s ease-in-out infinite alternate}
@keyframes ff-drift{from{transform:translateX(0)}to{transform:translateX(30px)}}
.ff-mist{animation:ff-mist 46s ease-in-out infinite alternate}
@keyframes ff-mist{from{transform:translateX(-16px)}to{transform:translateX(20px)}}
.ff-ambient{position:absolute; inset:0; overflow:hidden; pointer-events:none}
.ff-fly{
  position:absolute; width:4px; height:4px; border-radius:50%;
  background:#E8E081; opacity:0; box-shadow:0 0 7px 2px rgba(232,224,129,.55);
  animation:ff-pulse 4.2s ease-in-out infinite;
}
@keyframes ff-pulse{
  0%,100%{opacity:0; transform:translate(0,0)}
  45%{opacity:calc(.9 * var(--ff-fly-o)); transform:translate(4px,-9px)}
}
.ff-petal{
  position:absolute; top:-4%; width:7px; height:5px;
  border-radius:60% 40% 55% 45%; opacity:0;
  animation-name:ff-fall; animation-timing-function:linear; animation-iteration-count:infinite;
}
@keyframes ff-fall{
  0%{opacity:0; transform:translate(0,-10px) rotate(0deg)}
  7%{opacity:calc(.8 * var(--ff-petal-o))}
  85%{opacity:calc(.45 * var(--ff-petal-o))}
  100%{opacity:0; transform:translate(-90px,470px) rotate(310deg)}
}
.ff-bird{position:absolute; top:11%; left:0; color:#44523E; opacity:calc(.65 * var(--ff-petal-o)); animation:ff-flight 84s linear infinite}
@keyframes ff-flight{
  0%{transform:translate(-40px,0)}
  10%{transform:translate(310px,-16px)}
  20%{transform:translate(660px,4px)}
  30%{transform:translate(1040px,-14px)}
  30.001%,100%{transform:translate(1040px,-14px)}
}
.ff-tip{position:absolute; display:none; z-index:3; pointer-events:none; max-width:250px;
  background:#fff; border-radius:10px; padding:10px 14px; font-size:13px; line-height:1.5;
  box-shadow:0 10px 15px -3px rgb(0 0 0/.15),0 4px 6px -4px rgb(0 0 0/.1); color:#1e293b}
.dark .ff-tip{background:#0f172a; color:#e2e8f0; border:1px solid #1e293b}
.ff-tip p{margin:0}
.ff-tip-t{font-weight:700; display:flex; align-items:center; gap:6px; margin-bottom:2px}
.ff-tip-dot{width:9px; height:9px; border-radius:50%; flex:none}
.ff-tip-m{color:#64748b; font-variant-numeric:tabular-nums}
.dark .ff-tip-m{color:#94a3b8}
@media (prefers-reduced-motion: reduce){
  .ff-grow{transform:scale(1)} .ff-grow.in{transition:none}
  .ff-drift,.ff-sway,.ff-mist{animation:none}
  .ff-ambient{display:none}
}
`
