// The forest's drawing kit: species, painterly SVG primitives, the backdrop,
// trees, landmarks, and the theme CSS. Shared by the month groves
// (components/ForestPanel.jsx) and the project ecosystems
// (components/ProjectForest.jsx), so both forests are one visual language.
// Rendering is imperative SVG driven entirely by CSS variables, so the
// dashboard's .dark class flips every scene to night without re-rendering.

// Species are assigned from the user's REAL categories, not a seeded list:
// name heuristics pick a fitting look, anything unmatched gets a stable one
// by hash, and sessions from before the intention gate (null category) stand
// as sage "Uncategorized" trees.
export const LOOKS = ['pine', 'leaf', 'maple', 'cherry', 'cypress']
export const nameHash = (s) => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7)
export function speciesFor(cat) {
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

export const NS = 'http://www.w3.org/2000/svg'
export function el(n, a, parent) {
  const e = document.createElementNS(NS, n)
  for (const k in a) e.setAttribute(k, a[k])
  if (parent) parent.appendChild(e)
  return e
}
export const jitter = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.545; return x - Math.floor(x) }
export const pts = (arr, sc) => arr.map((p) => `${p[0] * sc},${p[1] * sc}`).join(' ')

// Foliage as a continuous scale: ALIGN 50%..95% sweeps the species ramp from
// pale to rich via color-mix, so an 82% session is visibly between an 74% and
// an 89% one. Stays theme-adaptive because the endpoints are CSS variables.
// Unscored sessions sit at the middle of the ramp.
export function foliageFill(kind, align) {
  const t = align == null ? 0.5 : Math.max(0, Math.min(1, (align - 0.5) / 0.45))
  if (t <= 0.5) {
    return `color-mix(in oklab, var(--ff-${kind}-1) ${Math.round(t * 200)}%, var(--ff-${kind}-0))`
  }
  return `color-mix(in oklab, var(--ff-${kind}-2) ${Math.round((t - 0.5) * 200)}%, var(--ff-${kind}-1))`
}

// y of a hill-ellipse's upper edge at x — trees stand ON the terrain curves
// the backdrop draws, instead of in flat rows.
export function hillY(x, cx, cy, rx, ry) {
  const t = (x - cx) / rx
  return Math.abs(t) >= 1 ? cy : cy - ry * Math.sqrt(1 - t * t)
}

export const parseTs = (s) => new Date(String(s).replace(' ', 'T'))
export function durationMin(s) {
  const a = parseTs(s.started_at), b = parseTs(s.ended_at || s.started_at)
  const m = Math.round((b - a) / 60000)
  return Number.isFinite(m) && m > 0 ? m : 0
}
export const monthKey = (s) => String(s.started_at).slice(0, 7)
export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
export function seasonClass(key) {
  const m = Number(key.split('-')[1])
  if (m >= 3 && m <= 5) return 'ff-spring'
  if (m >= 6 && m <= 8) return 'ff-summer'
  if (m >= 9 && m <= 11) return 'ff-autumn'
  return 'ff-winter'
}
export const fmtDate = (s) =>
  parseTs(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function defsFor(svg, uid) {
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

export function drawBackdrop(svg, uid, seedOff) {
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

export function tinyPine(parent, x, y, s) {
  const g = el('g', { transform: `translate(${x.toFixed(1)},${y.toFixed(1)})` }, parent)
  el('polygon', { points: pts([[-16, 0], [16, 0], [0, -46]], s), fill: 'var(--ff-treeline)' }, g)
  el('polygon', { points: pts([[-11, -24], [11, -24], [0, -62]], s), fill: 'var(--ff-treeline)' }, g)
}

export function drawTree(kind, fill, sc, uid, seed = 0) {
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

export function drawLandmark(svg, uid, id, x, y) {
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
// What a session was: the category the intention itself was declared as. The
// observed category (what the monitor logged most) only stands in when nothing
// was declared AND it clearly dominated — a 48% plurality is not an identity:
// a "personal statement" session that spent 48% of its rows in Composition
// is still a college-application session, not a composition one.
export const OBSERVED_MIN_SHARE = 0.6
export const sessionCategory = (s) =>
  s.llm_category || (s.top_share != null && s.top_share >= OBSERVED_MIN_SHARE ? s.top_category : null)

export const fmtMin = (m) => (m >= 60 ? (m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} m`) : `${m} min`)

// Ambient life per grove: fireflies at night, drifting petals and a bird by
// day. Plain HTML spans over the SVG — GPU-composited, so none of it re-runs
// the painterly filters. Deterministic per grove, so re-renders don't reshuffle.
export function ambientSpans(idx) {
  const out = []
  for (let i = 0; i < 6; i++) {
    out.push({ t: 'fly', left: 8 + jitter(idx * 31 + i + 40) * 84, top: 46 + jitter(idx * 31 + i + 80) * 34, delay: jitter(idx * 31 + i + 120) * 4, dur: 3.4 + jitter(idx * 31 + i + 160) * 2.4 })
  }
  for (let i = 0; i < 6; i++) {
    out.push({ t: 'petal', left: 5 + jitter(idx * 47 + i + 200) * 90, delay: -jitter(idx * 47 + i + 240) * 16, dur: 13 + jitter(idx * 47 + i + 280) * 7, pink: i % 2 === 0 })
  }
  return out
}

// All scene color comes from these variables, so the dashboard's .dark class
// turns every grove to night without touching the SVG. Season classes only
// re-tint daylight; night is night in every season.
export const FOREST_CSS = `
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
.ff-tree.ff-hot .ff-sway [style],.ff-tree.ff-hot .ff-sway polygon[fill^="var("]{
  stroke:#FFFFFF; stroke-width:1.6; paint-order:stroke; stroke-linejoin:round;
  vector-effect:non-scaling-stroke; animation:ff-outline 1.1s ease-in-out infinite;
}
.dark .ff-tree.ff-hot .ff-sway [style],.dark .ff-tree.ff-hot .ff-sway polygon[fill^="var("]{stroke:#FFF3C4}
@keyframes ff-outline{0%,100%{stroke-opacity:.35}50%{stroke-opacity:1}}
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
.ff-tip-hint{margin-top:4px; font-size:11.5px; opacity:.8}
.dark .ff-tip-m{color:#94a3b8}
@media (prefers-reduced-motion: reduce){
  .ff-grow{transform:scale(1)} .ff-grow.in{transition:none}
  .ff-drift,.ff-sway,.ff-mist{animation:none}
  .ff-ambient{display:none}
}
`
