import { useEffect, useMemo, useRef, useState } from 'react'
import { isMonitorLive } from '../lib/dataSource'
import Mini from './MiniTree'
import {
  DEAD_DAYS, FADE_DAYS, FRESH_DAYS, STATES, WATER_MIN_ALIGN, isWatering, projectLife,
} from '../lib/projectLife'
import {
  ambientSpans, defsFor, drawBackdrop, drawLandmark, drawTree, durationMin, el, fmtDate,
  foliageFill, jitter, parseTs, pts, sessionCategory, speciesFor,
} from '../lib/forestDraw'

// The project forest: one ecosystem per project, centred on a single tree
// that IS the project. Finished sessions are what the ecosystem is made of —
// each one grows into a plant around the tree — and the good ones are
// waterings: a session at WATER_MIN_ALIGN or better keeps the tree alive.
//
// This forest is not purely positive, by the user's choice. A tree that goes
// unwatered fades, then wilts, then dies: after DEAD_DAYS without a watering
// it stands as a bare snag and the next good session plants a new, small tree
// beside it. Everything is derived from session history alone (no stored
// health), so it reads the same from the local API and the cloud mirror, and
// a session refiled into a project waters it retroactively.

const DAY = 86400000
const endT = (s) => parseTs(s.ended_at || s.started_at).getTime()

// The tree's size grows with the hours of its current life, on a curve that
// keeps a young project visibly small and lets an old one tower without
// leaving the frame: 80 hours is full size.
function treeScale(life) {
  if (life.state === 'seedling') return 0.42 + Math.min(0.2, life.hours * 0.04)
  return 0.9 + 1.2 * Math.min(1, Math.log1p(life.hours) / Math.log1p(80))
}

// Health, as colour: fresh foliage from the recent waterings' ALIGN; fading
// pulls toward autumn; wilting toward bare brown; dormant toward stone.
function treeFill(kind, life) {
  const base = foliageFill(kind, life.recentAlign)
  if (life.state === 'fading') {
    const f = (life.days - FRESH_DAYS) / (FADE_DAYS - FRESH_DAYS)
    return `color-mix(in oklab, var(--ff-maple-1) ${Math.round(20 + f * 55)}%, ${base})`
  }
  if (life.state === 'wilting') {
    const f = (life.days - FADE_DAYS) / (DEAD_DAYS - FADE_DAYS)
    return `color-mix(in oklab, var(--ff-stone) ${Math.round(35 + f * 45)}%, var(--ff-maple-2))`
  }
  if (life.state === 'dormant') return `color-mix(in oklab, var(--ff-stone) 55%, ${base})`
  return base
}

// A dead tree: bare trunk and a few broken limbs. No foliage, no sway.
function drawSnag(sc, seed = 0) {
  const g = el('g', { class: 'ff-grow ff-snag' })
  const L = (jitter(seed * 7 + 1) - 0.5) * 6
  const h = 48 * (0.9 + jitter(seed * 7 + 2) * 0.3)
  el('ellipse', { cx: 2 * sc, cy: 1, rx: 14 * sc, ry: 3.5 * sc, fill: '#000', opacity: 'var(--ff-shad-o)' }, g)
  el('polygon', { points: pts([[-4, 0], [4, 0], [2 + L, -h], [-1 + L, -h]], sc), fill: 'var(--ff-snag)' }, g)
  const limb = (x0, y0, x1, y1) =>
    el('line', { x1: x0 * sc, y1: y0 * sc, x2: x1 * sc, y2: y1 * sc, stroke: 'var(--ff-snag)', 'stroke-width': (2.2 * sc).toFixed(1), 'stroke-linecap': 'round' }, g)
  limb(L, -h * 0.55, L - 14, -h * 0.7)
  limb(L + 1, -h * 0.72, L + 12, -h * 0.9)
  if (jitter(seed * 7 + 3) > 0.4) limb(L - 1, -h * 0.4, L + 9, -h * 0.46)
  return g
}

// What a session grows into. Quality decides the kind, minutes the size.
function elementKind(s) {
  const a = s.avg_align
  const mins = durationMin(s)
  if (a != null && a >= 0.85 && mins >= 60) return 'bloom'
  if (isWatering(s)) return 'bush'
  if (a == null || a >= 0.5) return 'fern'
  return 'stone'
}
const ELEMENT_LABEL = { bloom: 'flowering bush', bush: 'bush', fern: 'fern', stone: 'stone' }

function drawElement(kind, fill, sc, seed) {
  const g = el('g', { class: 'ff-grow' })
  const v = (k, amt) => 1 + (jitter(seed * 11 + k) - 0.5) * 2 * amt
  const lobe = (cx, cy, r, extra) => el('circle', { cx: (cx * sc).toFixed(1), cy: (cy * sc).toFixed(1), r: (r * sc).toFixed(1), ...extra }, g)
  if (kind === 'stone') {
    el('ellipse', { cx: 0, cy: 0, rx: (11 * v(1, 0.25) * sc).toFixed(1), ry: (6 * v(2, 0.2) * sc).toFixed(1), fill: 'var(--ff-stone)' }, g)
    el('ellipse', { cx: (-3 * sc).toFixed(1), cy: (-2 * sc).toFixed(1), rx: (5 * sc).toFixed(1), ry: (2.2 * sc).toFixed(1), fill: '#fff', opacity: 'var(--ff-hi-o)' }, g)
    return g
  }
  if (kind === 'fern') {
    for (let i = -2; i <= 2; i++) {
      const ang = i * 22 + (jitter(seed * 11 + i + 5) - 0.5) * 10
      el('ellipse', {
        cx: 0, cy: (-9 * sc).toFixed(1), rx: (2.6 * sc).toFixed(1), ry: (11 * v(i + 8, 0.2) * sc).toFixed(1),
        transform: `rotate(${ang.toFixed(1)} 0 0)`, style: `fill:${fill}`, opacity: '.9',
      }, g)
    }
    return g
  }
  const st = { style: `fill:${fill}` }
  el('ellipse', { cx: (1 * sc).toFixed(1), cy: 1, rx: (13 * sc).toFixed(1), ry: (3 * sc).toFixed(1), fill: '#000', opacity: 'var(--ff-shad-o)' }, g)
  lobe(-7 * v(1, 0.3), -7, 8 * v(2, 0.2), st)
  lobe(7 * v(3, 0.3), -7, 8 * v(4, 0.2), st)
  lobe(0, -12 * v(5, 0.15), 9.5 * v(6, 0.15), st)
  lobe(-3, -14, 3.5, { fill: '#fff', opacity: 'var(--ff-hi-o)' })
  lobe(6, -5, 3.5, { fill: '#000', opacity: 'var(--ff-lo-o)' })
  if (kind === 'bloom') {
    for (let i = 0; i < 6; i++) {
      lobe((jitter(seed * 11 + 20 + i) - 0.5) * 20, -8 - jitter(seed * 11 + 30 + i) * 12, 1.9, { fill: 'var(--ff-bloom)', opacity: '.95' })
    }
  }
  return g
}

// Company for a well-kept tree. Small, still, and only ever earned.
function drawBird(parent, x, y, sc) {
  const g = el('g', { transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${sc.toFixed(2)})`, class: 'ff-critter' }, parent)
  el('ellipse', { cx: 0, cy: 0, rx: 5.5, ry: 3.6, fill: 'var(--ff-bird)' }, g)
  el('circle', { cx: 4.5, cy: -2.6, r: 2.4, fill: 'var(--ff-bird)' }, g)
  el('polygon', { points: '6.5,-2.6 9.5,-1.8 6.5,-1', fill: '#E0B04B' }, g)
  el('polygon', { points: '-5,-0.5 -10,-3.5 -8,1', fill: 'var(--ff-bird)' }, g)
}
function drawRabbit(parent, x, y, sc) {
  const g = el('g', { transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${sc.toFixed(2)})`, class: 'ff-critter' }, parent)
  el('ellipse', { cx: 0, cy: -4, rx: 7, ry: 5, fill: 'var(--ff-fur)' }, g)
  el('circle', { cx: 6, cy: -8, r: 3.4, fill: 'var(--ff-fur)' }, g)
  el('ellipse', { cx: 5, cy: -13.5, rx: 1.3, ry: 3.6, fill: 'var(--ff-fur)' }, g)
  el('ellipse', { cx: 8, cy: -13, rx: 1.3, ry: 3.6, fill: 'var(--ff-fur)' }, g)
  el('circle', { cx: -6.5, cy: -3, r: 1.8, fill: '#fff', opacity: '.8' }, g)
}

// Milestones inside one project's current life: the ecosystem fills in as
// the tree is kept. Features are drawn behind the plants, critters on top.
const FEATURES = [
  { id: 'bird', name: 'A bird', what: '5 waterings', test: (l) => l.lifeWaterings.length >= 5 },
  { id: 'pond', name: 'The pond', what: '10 waterings', test: (l) => l.lifeWaterings.length >= 10, spot: [190, 492, 80] },
  { id: 'rabbit', name: 'A rabbit', what: '15 waterings', test: (l) => l.lifeWaterings.length >= 15 },
  { id: 'bench', name: 'The bench', what: '25 waterings', test: (l) => l.lifeWaterings.length >= 25, spot: [115, 483, 40] },
  { id: 'lantern', name: 'The lantern', what: '30 hours', test: (l) => l.hours >= 30, spot: [880, 487, 36] },
  { id: 'cabin', name: 'The cabin', what: '100 hours', test: (l) => l.hours >= 100, spot: [848, 408, 50] },
]

function fillTip(tip, lines, hint) {
  tip.replaceChildren()
  lines.forEach((text, i) => {
    const p = document.createElement('p')
    p.className = i === 0 ? 'ff-tip-t' : 'ff-tip-m'
    p.textContent = text
    tip.append(p)
  })
  if (hint) {
    const p = document.createElement('p'); p.className = 'ff-tip-m ff-tip-hint'; p.textContent = hint
    tip.append(p)
  }
}

const grown = new Set()

function attachTip(node, svg, tip, lines, hint, onClick) {
  const placeTip = (ev) => {
    const box = svg.getBoundingClientRect()
    const mx = ev.clientX - box.left, my = ev.clientY - box.top
    const w = tip.offsetWidth || 240, h = tip.offsetHeight || 70
    tip.style.left = Math.min(Math.max(mx - w / 2, 8), box.width - w - 8) + 'px'
    tip.style.top = Math.max(my - h - 12, 4) + 'px'
  }
  const show = (ev) => {
    fillTip(tip, lines(), hint)
    tip.style.display = 'block'
    if (ev && ev.clientX != null) placeTip(ev)
    else {
      const r = svg.getBoundingClientRect()
      const [x, y] = (node.getAttribute('transform').match(/-?[\d.]+/g) || [500, 470]).map(Number)
      tip.style.left = Math.min(Math.max((x / 1000) * r.width - 100, 8), r.width - 260) + 'px'
      tip.style.top = Math.max((y / 520) * r.height - 128, 8) + 'px'
    }
  }
  const hide = () => { tip.style.display = 'none' }
  node.addEventListener('pointerenter', (ev) => { node.classList.add('ff-hot'); show(ev) })
  node.addEventListener('pointermove', placeTip)
  node.addEventListener('focus', () => { node.classList.add('ff-hot'); show() })
  node.addEventListener('pointerleave', () => { node.classList.remove('ff-hot'); hide() })
  node.addEventListener('blur', () => { node.classList.remove('ff-hot'); hide() })
  if (onClick) {
    node.addEventListener('click', onClick)
    node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') onClick() })
  }
}

function growIn(svg, stamp) {
  const replay = !grown.has(stamp)
  grown.add(stamp)
  const grows = [...svg.querySelectorAll('.ff-grow')]
  if (replay) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      grows.forEach((g, n) => { g.style.transitionDelay = Math.min(n * 45, 1400) + 'ms'; g.classList.add('in') })
    }))
  } else {
    grows.forEach((g) => g.classList.add('ff-instant', 'in'))
  }
}

// Plants spread out from the tree on a seeded sunflower spiral, flattened to
// the ground plane, so a well-kept project fills its clearing evenly.
function spiralSpot(i, seedOff, spread = 1) {
  const a = i * 2.39996 + seedOff * 0.37
  const r = (78 + 30 * Math.sqrt(i + 1)) * spread
  const x = 500 + Math.cos(a) * r * 1.75 + (jitter(seedOff + i * 3) - 0.5) * 24
  const y = 476 + Math.sin(a) * r * 0.42 + (jitter(seedOff + i * 3 + 1) - 0.5) * 10
  return { x: Math.min(950, Math.max(50, x)), y: Math.min(508, Math.max(398, y)) }
}

function renderEcosystem(svg, tip, life, uid, seedOff, onPick) {
  svg.replaceChildren()
  defsFor(svg, uid)
  drawBackdrop(svg, uid, seedOff)
  const earned = FEATURES.filter((f) => f.test(life))
  earned.filter((f) => f.spot).forEach((f) => drawLandmark(svg, uid, f.id, f.spot[0], f.spot[1]))

  const fgBand = el('ellipse', { cx: 500, cy: 600, rx: 860, ry: 110, fill: 'var(--ff-fg-band)', opacity: '.85', filter: `url(#rough${uid})` }, svg)
  const layer = []   // { y, node } sorted back to front

  // Prior lives: snags standing back where the old trees were.
  const snagSpots = [[300, 438], [712, 442], [232, 462], [770, 466], [420, 432], [590, 434]]
  for (let k = 0; k < Math.min(life.snags, snagSpots.length); k++) {
    const [x, y] = snagSpots[k]
    const g = el('g', { class: 'ff-tree', transform: `translate(${x},${y})`, tabindex: '0', 'aria-label': 'a withered tree from an earlier life of this project' })
    g.appendChild(drawSnag(0.6 + jitter(seedOff + k) * 0.2, seedOff + k))
    attachTip(g, svg, tip, () => ['An earlier tree', `Withered after ${DEAD_DAYS} days without a watering.`])
    layer.push({ y, node: g })
  }

  // The project itself.
  const p = life.project
  const sp = speciesFor(p.category || (life.rows.length ? sessionCategory(life.rows[life.rows.length - 1]) : null))
  const sc = treeScale(life)
  const center = el('g', {
    class: `ff-tree ff-center ff-${life.state}`, transform: 'translate(500,476)', tabindex: '0',
    'aria-label': `${p.name}, ${STATES[life.state].label}`,
  })
  if (life.state === 'dead') center.appendChild(drawSnag(Math.max(sc, 0.9), seedOff + 99))
  else center.appendChild(drawTree(sp.kind, treeFill(sp.kind, life), sc, uid, seedOff + 99))
  attachTip(center, svg, tip, () => {
    const n = life.lifeWaterings.length
    const last = life.lifeWaterings.length ? `last watered ${fmtDate(life.lifeWaterings[n - 1].ended_at)}` : 'never watered'
    const lines = [p.name, `${STATES[life.state].label} · ${n} watering${n === 1 ? '' : 's'} · ${life.hours.toFixed(1)} h this life`, last]
    if (life.state === 'seedling') lines[2] = `Waiting for its first watering: a session at ${Math.round(WATER_MIN_ALIGN * 100)}%+ align.`
    if (life.state === 'dead') lines[2] = 'The next good session plants a new tree here.'
    return lines
  })
  layer.push({ y: 476, node: center })

  // Sessions of the current life, oldest nearest the tree.
  life.lifeRows.forEach((s, i) => {
    const kind = elementKind(s)
    const { x, y } = spiralSpot(i, seedOff)
    const mins = durationMin(s)
    const esc = 1.05 + Math.min(1, mins / 120) * 0.6
    const fill = foliageFill(speciesFor(sessionCategory(s) || p.category).kind, s.avg_align)
    const g = el('g', {
      class: 'ff-tree ff-plant', transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, tabindex: '0',
      'aria-label': `${s.text}, ${ELEMENT_LABEL[kind]}, ${mins} minutes`,
    })
    g.appendChild(drawElement(kind, fill, esc, i + seedOff))
    attachTip(g, svg, tip, () => {
      const alignTxt = s.avg_align == null ? 'ALIGN —' : `ALIGN ${Math.round(s.avg_align * 100)}%`
      const cat = sessionCategory(s) || p.category || 'Uncategorized'
      return [s.text, `${cat} · ${fmtDate(s.started_at)}`, `${mins} min · ${alignTxt} · ${isWatering(s) ? 'a watering' : 'not a watering'}`]
    }, isMonitorLive() ? 'Click to change the category or project' : null, onPick ? () => onPick(s) : null)
    layer.push({ y, node: g })
  })

  layer.sort((a, b) => a.y - b.y).forEach(({ node }) => svg.insertBefore(node, fgBand))
  const critters = el('g', {}, svg)
  if (earned.some((f) => f.id === 'bird') && life.state !== 'dead') drawBird(critters, 500 + 14 * sc, 476 - 52 * sc, 0.9 + sc * 0.3)
  if (earned.some((f) => f.id === 'rabbit')) drawRabbit(critters, 610, 500, 1.1)
  growIn(svg, `${p.id}:${life.lifeRows.length}:${life.state}:${life.snags}`)
}

// The wilds: sessions filed under no project, each its own small tree, kept
// so nothing already grown disappears — and so filing one is a visible upgrade.
function renderWilds(svg, tip, rows, uid, seedOff, onPick) {
  svg.replaceChildren()
  defsFor(svg, uid)
  drawBackdrop(svg, uid, seedOff)
  const fgBand = el('ellipse', { cx: 500, cy: 600, rx: 860, ry: 110, fill: 'var(--ff-fg-band)', opacity: '.85', filter: `url(#rough${uid})` }, svg)
  const layer = []
  rows.forEach((s, i) => {
    const { x, y } = spiralSpot(i, seedOff, 1.15)
    const sp = speciesFor(sessionCategory(s))
    const mins = durationMin(s)
    const sc = 0.45 + Math.min(1, mins / 120) * 0.3
    const g = el('g', {
      class: 'ff-tree', transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, tabindex: '0',
      'aria-label': `${s.text}, ${sp.label}, ${mins} minutes, no project`,
    })
    g.appendChild(drawTree(sp.kind, foliageFill(sp.kind, s.avg_align), sc, uid, i + seedOff))
    attachTip(g, svg, tip, () => {
      const alignTxt = s.avg_align == null ? 'ALIGN —' : `ALIGN ${Math.round(s.avg_align * 100)}%`
      return [s.text, `${sp.label} · ${fmtDate(s.started_at)}`, `${mins} min · ${alignTxt} · no project`]
    }, isMonitorLive() ? 'Click to file it under a project' : null, onPick ? () => onPick(s) : null)
    layer.push({ y, node: g })
  })
  layer.sort((a, b) => a.y - b.y).forEach(({ node }) => svg.insertBefore(node, fgBand))
  growIn(svg, `wilds:${rows.length}`)
}

function whisperFor(life) {
  const d = Math.round(life.days)
  switch (life.state) {
    case 'seedling':
      return `Planted ${fmtDate(life.project.created_at)}. One session at ${Math.round(WATER_MIN_ALIGN * 100)}%+ align and it takes root.`
    case 'thriving': {
      const week = life.lifeWaterings.filter((w) => life.lastT - endT(w) <= 7 * DAY).length
      return week > 1
        ? `${week} waterings this week. The canopy is thickening.`
        : `Watered ${d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`}. Keep it up and the colour deepens.`
    }
    case 'fading':
      return `${d} days since the last watering. A good session this week brings the green back.`
    case 'wilting':
      return `${d} days dry. ${life.daysLeft} more and this tree is gone.`
    case 'dead':
      return life.waterings.length ? `Withered after ${DEAD_DAYS} days without water. Its next good session plants again.`
        : `Never watered, and ${d} days on. A good session starts it over.`
    case 'dormant':
      return 'Resting. Restore the project on the Projects tab to wake it.'
    default:
      return ''
  }
}

function Ecosystem({ life, idx, onPick }) {
  const svgRef = useRef(null)
  const tipRef = useRef(null)
  const sectionRef = useRef(null)
  useEffect(() => {
    renderEcosystem(svgRef.current, tipRef.current, life, 'p' + life.project.id, life.project.id * 41, onPick)
  }, [life, onPick])
  useEffect(() => {
    const node = sectionRef.current
    const io = new IntersectionObserver(([e]) => node.classList.toggle('ff-live', e.intersectionRatio >= 0.5), { threshold: [0, 0.5, 1] })
    io.observe(node)
    return () => io.disconnect()
  }, [])
  const st = STATES[life.state]
  const n = life.lifeWaterings.length
  return (
    <section ref={sectionRef} className={`ff-grove ${st.season}`} data-key={`p${life.project.id}`}>
      <div className="relative">
        <svg ref={svgRef} viewBox="0 0 1000 520" role="img" aria-label={`${life.project.name}, ${st.label}`} />
        {life.state !== 'dead' && life.state !== 'dormant' && (
          <div className="ff-ambient" aria-hidden="true">
            {ambientSpans(idx).map((a, i) => a.t === 'fly'
              ? <span key={i} className="ff-fly" style={{ left: `${a.left}%`, top: `${a.top}%`, animationDelay: `${a.delay.toFixed(2)}s`, animationDuration: `${a.dur.toFixed(2)}s` }} />
              : <span key={i} className="ff-petal" style={{ left: `${a.left}%`, animationDelay: `${a.delay.toFixed(2)}s`, animationDuration: `${a.dur.toFixed(2)}s`, background: a.pink ? 'var(--ff-cherry-0)' : 'var(--ff-leaf-0)' }} />)}
          </div>
        )}
        <div ref={tipRef} className="ff-tip" />
      </div>
      <div className="px-5 py-4">
        <div className="flex justify-between items-baseline gap-3 flex-wrap">
          <span className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {life.project.name}
            <span className={`ml-2 text-xs font-semibold uppercase tracking-wider ${st.tone}`}>{st.label}</span>
          </span>
          <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">
            {n} watering{n === 1 ? '' : 's'} · {life.hours.toFixed(1)} h
            {life.snags ? ` · ${life.snags} earlier ${life.snags === 1 ? 'life' : 'lives'}` : ''}
            {life.allHours > life.hours + 0.05 ? ` · ${life.allHours.toFixed(1)} h all time` : ''}
          </span>
        </div>
        <p className="mt-1 text-[15px] italic font-serif text-slate-500 dark:text-slate-400">{whisperFor(life)}</p>
      </div>
    </section>
  )
}

function Wilds({ rows, onPick }) {
  const svgRef = useRef(null)
  const tipRef = useRef(null)
  const sectionRef = useRef(null)
  useEffect(() => { renderWilds(svgRef.current, tipRef.current, rows, 'wild', 977, onPick) }, [rows, onPick])
  useEffect(() => {
    const node = sectionRef.current
    const io = new IntersectionObserver(([e]) => node.classList.toggle('ff-live', e.intersectionRatio >= 0.5), { threshold: [0, 0.5, 1] })
    io.observe(node)
    return () => io.disconnect()
  }, [])
  const hrs = rows.reduce((a, s) => a + durationMin(s), 0) / 60
  return (
    <section ref={sectionRef} className="ff-grove ff-spring" data-key="wilds">
      <div className="relative">
        <svg ref={svgRef} viewBox="0 0 1000 520" role="img" aria-label="The wilds: sessions with no project" />
        <div ref={tipRef} className="ff-tip" />
      </div>
      <div className="px-5 py-4">
        <div className="flex justify-between items-baseline gap-3 flex-wrap">
          <span className="text-lg font-semibold text-slate-800 dark:text-slate-100">The wilds</span>
          <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">{rows.length} sessions · {hrs.toFixed(1)} h · no project</span>
        </div>
        <p className="mt-1 text-[15px] italic font-serif text-slate-500 dark:text-slate-400">
          Sessions that belong to no project grow wild. Click one to file it under a project — it waters that tree.
        </p>
      </div>
    </section>
  )
}

const ORDER = { thriving: 0, fading: 1, wilting: 2, seedling: 3, dead: 4, dormant: 5 }

export default function ProjectForest({ projects, sessions, onPick }) {
  // One clock per mount: health is a function of "now", and a page left open
  // overnight should not re-rank its ecosystems under the reader's cursor.
  const [now] = useState(() => Date.now())
  const scrollerRef = useRef(null)
  const [activeKey, setActiveKey] = useState(null)

  const { lives, wilds } = useMemo(() => {
    const rows = (sessions || []).filter((s) => s.started_at && s.ended_at)
    const lives = (projects || []).map((p) => projectLife(p, rows, now))
    lives.sort((a, b) => (ORDER[a.state] - ORDER[b.state]) || (b.lastT - a.lastT))
    const known = new Set((projects || []).map((p) => p.id))
    const wilds = rows.filter((s) => s.project_id == null || !known.has(s.project_id))
      .sort((a, b) => (a.started_at < b.started_at ? -1 : 1))
    return { lives, wilds }
  }, [projects, sessions, now])

  const keys = useMemo(() => [...lives.map((l) => `p${l.project.id}`), ...(wilds.length ? ['wilds'] : [])], [lives, wilds])

  useEffect(() => {
    const sc = scrollerRef.current
    if (!sc || !keys.length) return
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
    scrollerRef.current?.querySelector(`[data-key="${key}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }

  if (!lives.length && !wilds.length) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-8 rounded-lg shadow-md text-center">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">The clearing is waiting</h2>
        <p className="text-slate-500 dark:text-slate-400">
          Add a project on the Projects tab and it takes root here as a seedling. Every good session you file under it is a watering.
        </p>
      </div>
    )
  }

  const count = (st) => lives.filter((l) => l.state === st).length
  const needWater = count('fading') + count('wilting')
  const weekWaterings = lives.reduce((a, l) => a + l.lifeWaterings.filter((w) => now - endT(w) <= 7 * DAY).length, 0)
  const stats = [
    { k: 'Trees standing', v: lives.filter((l) => l.state !== 'dead' && l.state !== 'dormant').length, u: `of ${lives.length} projects` },
    { k: 'Thriving', v: count('thriving'), u: 'watered this week' },
    { k: 'Need water', v: needWater, u: needWater ? 'fading or wilting' : 'nothing is fading' },
    { k: 'Waterings', v: weekWaterings, u: 'in the last 7 days' },
  ]

  return (
    <div>
      <style>{ECO_CSS}</style>
      <p className="mb-4 text-[15px] italic font-serif text-slate-500 dark:text-slate-400">
        Every project is a tree. A finished session at {Math.round(WATER_MIN_ALIGN * 100)}%+ align waters it; {DEAD_DAYS} days without water and it withers.
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
        {lives.map((l) => (
          <button
            key={l.project.id}
            onClick={() => jumpTo(`p${l.project.id}`)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              activeKey === `p${l.project.id}`
                ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ background: STATES[l.state].dot }} aria-hidden="true" />
            {l.project.name}
          </button>
        ))}
        {wilds.length > 0 && (
          <button
            onClick={() => jumpTo('wilds')}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              activeKey === 'wilds'
                ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            The wilds <span className="opacity-60 tabular-nums">{wilds.length}</span>
          </button>
        )}
      </div>

      <div ref={scrollerRef} className="ff-scroller">
        {lives.map((l, i) => <Ecosystem key={l.project.id} life={l} idx={i} onPick={onPick} />)}
        {wilds.length > 0 && <Wilds rows={wilds} onPick={onPick} />}
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-3 mt-6 items-stretch">
        <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-lg shadow-md p-5">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 mb-3">Health is time since the last watering</p>
          <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
            {[['thriving', `within ${FRESH_DAYS} days`], ['fading', `${FRESH_DAYS} to ${FADE_DAYS} days: the canopy turns`], ['wilting', `${FADE_DAYS} to ${DEAD_DAYS} days: bare and brown`], ['dead', `past ${DEAD_DAYS} days: a snag; the next watering plants anew`], ['dormant', 'archived: resting, never withers']].map(([st, txt]) => (
              <li key={st} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-none" style={{ background: STATES[st].dot }} />
                <span><span className={`font-semibold ${STATES[st].tone}`}>{STATES[st].label}</span> · {txt}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-lg shadow-md p-5">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 mb-3">Every session is a plant</p>
          <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5">
            <li><span className="font-semibold text-slate-700 dark:text-slate-200">Flowering bush</span> · an hour or more at 85%+ align</li>
            <li><span className="font-semibold text-slate-700 dark:text-slate-200">Bush</span> · a watering: {Math.round(WATER_MIN_ALIGN * 100)}%+ align</li>
            <li><span className="font-semibold text-slate-700 dark:text-slate-200">Fern</span> · finished, but drifting; counts as hours, not water</li>
            <li><span className="font-semibold text-slate-700 dark:text-slate-200">Stone</span> · finished, mostly off intention</li>
          </ul>
          <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">Longer sessions grow bigger plants. The tree itself grows with the hours of its current life.</p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-lg shadow-md p-5 flex flex-col">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 mb-3">A kept tree draws company</p>
          <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 grow">
            {FEATURES.map((f) => <li key={f.id}><span className="font-semibold text-slate-700 dark:text-slate-200">{f.name}</span> · {f.what}</li>)}
          </ul>
          <div className="flex items-end gap-3 mt-2">
            <Mini kind="leaf" align={0.9} sc={0.42} w={48} h={44} />
            <Mini kind="leaf" align={0.9} sc={0.62} w={60} h={60} />
            <span className="text-[11px] text-slate-400 dark:text-slate-500 pb-1">Counted within the tree's current life.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Colours the ecosystems add to the shared forest palette.
const ECO_CSS = `
.ff-root{--ff-snag:#7A6653; --ff-bloom:#F2A9C3; --ff-bird:#3F4A3B; --ff-fur:#C9B79A}
.dark .ff-root{--ff-snag:#4E4036; --ff-bloom:#B86F8E; --ff-bird:#8E9A8A; --ff-fur:#7C7160}
.ff-wilting .ff-sway [style]{opacity:.55}
.ff-dormant .ff-sway [style]{opacity:.7}
.ff-dormant .ff-sway,.ff-wilting .ff-sway{animation:none}
.ff-critter{pointer-events:none}
.ff-tree.ff-hot .ff-grow>circle[style],.ff-tree.ff-hot .ff-grow>ellipse[style]{
  stroke:#FFFFFF; stroke-width:1.6; paint-order:stroke; vector-effect:non-scaling-stroke;
  animation:ff-outline 1.1s ease-in-out infinite}
.dark .ff-tree.ff-hot .ff-grow>circle[style],.dark .ff-tree.ff-hot .ff-grow>ellipse[style]{stroke:#FFF3C4}
`
