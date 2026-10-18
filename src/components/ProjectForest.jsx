import { useEffect, useMemo, useRef, useState } from 'react'
import EdgeArrows from './EdgeArrows'
import { isMonitorLive } from '../lib/dataSource'
import Mini from './MiniTree'
import {
  DEAD_DAYS, FADE_DAYS, FRESH_DAYS, STATES, WATER_MIN_ALIGN, isWatering, projectLife,
} from '../lib/projectLife'
import {
  ambientSpans, defsFor, drawBackdrop, drawLandmark, drawTree, durationMin, el, fmtDate,
  foliageFill, hillY, jitter, parseTs, pts, sessionCategory, speciesFor, addHalo,
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
//
// The forest answers the pointer. A bush rustles under it; a click shakes a
// tree and sheds its leaves, startles the bird and sends the rabbit off; the
// landmarks and the animals tell how they were earned, the pond ripples, the
// lantern lights (and stays lit); and a click pins the thing's story under
// the scene — refiling is a button on that card, never the click itself.
// Under the scroller, a scrubber replays the forest's history: health is a
// pure function of "now", so every ecosystem is simply drawn as of that day.

const DAY = 86400000
const endT = (s) => parseTs(s.ended_at || s.started_at).getTime()

// The tree's size grows with the hours of its current life, on a curve that
// keeps a young project visibly small and lets an old one tower without
// leaving the frame: 80 hours is full size.
function treeScale(life) {
  if (life.state === 'seedling') return 0.42 + Math.min(0.2, life.hours * 0.04)
  return 0.9 + 0.6 * treeGrowth(life)
}
// How grown the tree is, 0..1 on the same hours curve: drawTree spends it
// mostly on height and side limbs, so a kept project stands tall rather
// than merely swollen.
function treeGrowth(life) {
  if (life.state === 'seedling') return 0
  return Math.min(1, Math.log1p(life.hours) / Math.log1p(80))
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
  const r = el('g', { class: 'ff-rustle', 'data-kind': 'snag' }, g)
  const L = (jitter(seed * 7 + 1) - 0.5) * 6
  const h = 48 * (0.9 + jitter(seed * 7 + 2) * 0.3)
  el('ellipse', { cx: 2 * sc, cy: 1, rx: 14 * sc, ry: 3.5 * sc, fill: '#000', opacity: 'var(--ff-shad-o)' }, g)
  el('polygon', { points: pts([[-4, 0], [4, 0], [2 + L, -h], [-1 + L, -h]], sc), fill: 'var(--ff-snag)' }, r)
  const limb = (x0, y0, x1, y1) =>
    el('line', { x1: x0 * sc, y1: y0 * sc, x2: x1 * sc, y2: y1 * sc, stroke: 'var(--ff-snag)', 'stroke-width': (2.2 * sc).toFixed(1), 'stroke-linecap': 'round' }, r)
  limb(L, -h * 0.55, L - 14, -h * 0.7)
  limb(L + 1, -h * 0.72, L + 12, -h * 0.9)
  if (jitter(seed * 7 + 3) > 0.4) limb(L - 1, -h * 0.4, L + 9, -h * 0.46)
  return g
}

// What a session grows into. Quality decides the kind, minutes the size.
// A flowering bush is the best kind of session: 85%+ align held for at
// least BLOOM_MIN minutes. 45 rather than 60: an hour of unbroken focus is
// a rare thing, and the flowers are meant to be earned often enough to
// want them.
const BLOOM_MIN = 45
const BLOOM_ALIGN = 0.85
function elementKind(s) {
  const a = s.avg_align
  const mins = durationMin(s)
  if (a != null && a >= BLOOM_ALIGN && mins >= BLOOM_MIN) return 'bloom'
  if (isWatering(s)) return 'bush'
  if (a == null || a >= 0.5) return 'fern'
  return 'stone'
}
const ELEMENT_LABEL = { bloom: 'flowering bush', bush: 'bush', fern: 'fern', stone: 'stone' }

// Every plant is two groups: the outer one grows in (a scale transition on
// .ff-grow), the inner .ff-rustle one moves when the pointer touches it — a
// rustle for the green things, a wobble for a stone. Two elements because a
// CSS animation and a transition on the same transform fight.
function drawElement(kind, fill, sc, seed) {
  const g = el('g', { class: 'ff-grow' })
  const v = (k, amt) => 1 + (jitter(seed * 11 + k) - 0.5) * 2 * amt
  const r = el('g', { class: 'ff-rustle', 'data-kind': kind })
  const lobe = (cx, cy, rad, extra) => el('circle', { cx: (cx * sc).toFixed(1), cy: (cy * sc).toFixed(1), r: (rad * sc).toFixed(1), ...extra }, r)
  if (kind === 'stone') {
    el('ellipse', { cx: 0, cy: 0, rx: (11 * v(1, 0.25) * sc).toFixed(1), ry: (6 * v(2, 0.2) * sc).toFixed(1), fill: 'var(--ff-stone)' }, r)
    el('ellipse', { cx: (-3 * sc).toFixed(1), cy: (-2 * sc).toFixed(1), rx: (5 * sc).toFixed(1), ry: (2.2 * sc).toFixed(1), fill: '#fff', opacity: 'var(--ff-hi-o)' }, r)
    addHalo(r)
    g.appendChild(r)
    return g
  }
  if (kind === 'fern') {
    for (let i = -2; i <= 2; i++) {
      const ang = i * 22 + (jitter(seed * 11 + i + 5) - 0.5) * 10
      el('ellipse', {
        cx: 0, cy: (-9 * sc).toFixed(1), rx: (2.6 * sc).toFixed(1), ry: (11 * v(i + 8, 0.2) * sc).toFixed(1),
        transform: `rotate(${ang.toFixed(1)} 0 0)`, style: `fill:${fill}`, opacity: '.9',
      }, r)
    }
    addHalo(r, 2)
    g.appendChild(r)
    return g
  }
  const st = { style: `fill:${fill}` }
  // The shadow stays on the ground while the bush above it moves.
  el('ellipse', { cx: (1 * sc).toFixed(1), cy: 1, rx: (13 * sc).toFixed(1), ry: (3 * sc).toFixed(1), fill: '#000', opacity: 'var(--ff-shad-o)' }, g)
  lobe(-7 * v(1, 0.3), -7, 8 * v(2, 0.2), st)
  lobe(7 * v(3, 0.3), -7, 8 * v(4, 0.2), st)
  lobe(0, -12 * v(5, 0.15), 9.5 * v(6, 0.15), st)
  lobe(-3, -14, 3.5, { fill: '#fff', opacity: 'var(--ff-hi-o)' })
  lobe(6, -5, 3.5, { fill: '#000', opacity: 'var(--ff-lo-o)' })
  addHalo(r)
  if (kind === 'bloom') {
    // Flowers big enough to read as flowers from across the card: a bloom
    // in the accent pink with a bright heart, scattered over the top of the
    // bush. Six 2px specks were indistinguishable from the bush's own
    // highlights.
    for (let i = 0; i < 7; i++) {
      const fx = (jitter(seed * 11 + 20 + i) - 0.5) * 22
      const fy = -9 - jitter(seed * 11 + 30 + i) * 12
      lobe(fx, fy, 3.4, { fill: 'var(--ff-bloom)' })
      lobe(fx, fy, 1.3, { fill: 'var(--ff-bloom-heart)' })
    }
  }
  g.appendChild(r)
  return g
}

// Company for a well-kept tree. Small, still, and only ever earned.
// The critters move. Each lives in a static outer group (its spot and
// size, as attributes) with the animated parts inside, because a CSS
// animation's transform replaces an attribute transform on the same
// element. The animations are long loops that are mostly stillness — a
// peck, a tail flick, a wing stretch; an ear twitch, a short hop out and
// back — so the scene stays calm and the movement is something you catch
// rather than something that nags. They pause with the rest of the grove
// when it is off screen, and switch off under prefers-reduced-motion.
// Between the spot and the loop sits one more group (.ff-flyer, .ff-hopper)
// that plays the one-off reaction to a click: the bird's loop off the perch
// and back, the rabbit's bolt. Its own element, for the same reason.
function drawBird(parent, x, y, sc) {
  const spot = el('g', { transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${sc.toFixed(2)})`, class: 'ff-critter', 'data-critter': 'bird', tabindex: '0', 'aria-label': 'A bird' }, parent)
  const fly = el('g', { class: 'ff-flyer' }, spot)
  const g = el('g', { class: 'ff-perched' }, fly)
  // A generous invisible hit area: the bird is a dozen units across.
  el('circle', { cx: 1, cy: -3, r: 13, fill: 'transparent' }, g)
  el('polygon', { points: '-5,-0.5 -10,-3.5 -8,1', fill: 'var(--ff-bird)', class: 'ff-perched-tail' }, g)
  el('ellipse', { cx: 0, cy: 0, rx: 5.5, ry: 3.6, fill: 'var(--ff-bird)' }, g)
  el('ellipse', { cx: -0.8, cy: -0.4, rx: 3.4, ry: 2, fill: 'var(--ff-bird)', style: 'filter:brightness(.82)', class: 'ff-perched-wing' }, g)
  const head = el('g', { class: 'ff-perched-head' }, g)
  el('circle', { cx: 4.5, cy: -2.6, r: 2.4, fill: 'var(--ff-bird)' }, head)
  el('polygon', { points: '6.5,-2.6 9.5,-1.8 6.5,-1', fill: '#E0B04B' }, head)
  return spot
}
function drawRabbit(parent, x, y, sc) {
  const spot = el('g', { transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${sc.toFixed(2)})`, class: 'ff-critter', 'data-critter': 'rabbit', tabindex: '0', 'aria-label': 'A rabbit' }, parent)
  const hop = el('g', { class: 'ff-hopper' }, spot)
  const g = el('g', { class: 'ff-rabbit' }, hop)
  el('ellipse', { cx: 1, cy: -7, rx: 13, ry: 11, fill: 'transparent' }, g)
  el('ellipse', { cx: 0, cy: -4, rx: 7, ry: 5, fill: 'var(--ff-fur)' }, g)
  el('circle', { cx: 6, cy: -8, r: 3.4, fill: 'var(--ff-fur)' }, g)
  el('ellipse', { cx: 5, cy: -13.5, rx: 1.3, ry: 3.6, fill: 'var(--ff-fur)', class: 'ff-rabbit-ear' }, g)
  el('ellipse', { cx: 8, cy: -13, rx: 1.3, ry: 3.6, fill: 'var(--ff-fur)', class: 'ff-rabbit-ear ff-rabbit-ear-b' }, g)
  el('circle', { cx: -6.5, cy: -3, r: 1.8, fill: '#fff', opacity: '.8' }, g)
  return spot
}

// Milestones inside one project's current life: the ecosystem fills in as
// the tree is kept. Features are drawn behind the plants, critters on top.
const FEATURES = [
  { id: 'bird', name: 'A bird', what: '5 waterings', need: { waterings: 5 }, test: (l) => l.lifeWaterings.length >= 5 },
  { id: 'pond', name: 'The pond', what: '10 waterings', need: { waterings: 10 }, test: (l) => l.lifeWaterings.length >= 10, spot: [190, 492, 80] },
  { id: 'rabbit', name: 'A rabbit', what: '15 waterings', need: { waterings: 15 }, test: (l) => l.lifeWaterings.length >= 15 },
  { id: 'bench', name: 'The bench', what: '25 waterings', need: { waterings: 25 }, test: (l) => l.lifeWaterings.length >= 25, spot: [115, 483, 40] },
  { id: 'lantern', name: 'The lantern', what: '30 hours', need: { hours: 30 }, test: (l) => l.hours >= 30, spot: [880, 487, 36] },
  { id: 'cabin', name: 'The cabin', what: '100 hours', need: { hours: 100 }, test: (l) => l.hours >= 100, spot: [848, 408, 50] },
]
const LIGHTABLE = new Set(['lantern', 'cabin'])

// The session that earned a feature: the Nth watering, or the one whose
// minutes carried the life past the hour mark.
function earnedBy(f, life) {
  if (f.need.waterings) return life.lifeWaterings[f.need.waterings - 1] || null
  let h = 0
  for (const s of life.lifeRows) {
    h += durationMin(s) / 60
    if (h >= f.need.hours) return s
  }
  return null
}
// What the next landmark still wants, in words.
function nextFeature(life) {
  const f = FEATURES.find((x) => !x.test(life))
  if (!f) return null
  const left = f.need.waterings
    ? `${f.need.waterings - life.lifeWaterings.length} more watering${f.need.waterings - life.lifeWaterings.length === 1 ? '' : 's'}`
    : `${Math.ceil(f.need.hours - life.hours)} more hours`
  return { f, left }
}

// Which lanterns and cabin windows are lit, per project: the one thing the
// forest remembers that no session decided. Kept in this browser only.
const LIT_KEY = 'cft.forest.lit'
function readLit() { try { return JSON.parse(localStorage.getItem(LIT_KEY) || '{}') || {} } catch { return {} } }
function writeLit(map) { try { localStorage.setItem(LIT_KEY, JSON.stringify(map)) } catch { /* private window: lit for this page only */ } }

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

// hint may be a function, for hints that change with what a click did.
function attachTip(node, svg, tip, lines, { hint = null, onClick = null, onEnter = null } = {}) {
  const placeTip = (ev) => {
    const box = svg.getBoundingClientRect()
    const mx = ev.clientX - box.left, my = ev.clientY - box.top
    const w = tip.offsetWidth || 240, h = tip.offsetHeight || 70
    tip.style.left = Math.min(Math.max(mx - w / 2, 8), box.width - w - 8) + 'px'
    tip.style.top = Math.max(my - h - 12, 4) + 'px'
  }
  const show = (ev) => {
    fillTip(tip, lines(), typeof hint === 'function' ? hint() : hint)
    tip.style.display = 'block'
    if (ev && ev.clientX != null) placeTip(ev)
    else {
      const r = svg.getBoundingClientRect()
      const [x, y] = (node.getAttribute('transform') || '').match(/-?[\d.]+/g)?.map(Number) || [500, 470]
      tip.style.left = Math.min(Math.max((x / 1000) * r.width - 100, 8), r.width - 260) + 'px'
      tip.style.top = Math.max((y / 520) * r.height - 128, 8) + 'px'
    }
  }
  const hide = () => { tip.style.display = 'none' }
  node.addEventListener('pointerenter', (ev) => { node.classList.add('ff-hot'); if (onEnter) onEnter(); show(ev) })
  node.addEventListener('pointermove', placeTip)
  node.addEventListener('focus', () => { node.classList.add('ff-hot'); if (onEnter) onEnter(); show() })
  node.addEventListener('pointerleave', () => { node.classList.remove('ff-hot'); hide() })
  node.addEventListener('blur', () => { node.classList.remove('ff-hot'); hide() })
  if (onClick) {
    const go = (ev) => { onClick(ev); show(ev) }
    node.addEventListener('click', go)
    node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go() } })
  }
}

// A one-shot animation class: on again from the start if it is already
// playing, off by itself when it is done.
function playOnce(node, cls, ms) {
  if (!node) return
  if (node._once) clearTimeout(node._once)
  node.classList.remove(cls)
  void node.getBoundingClientRect()
  node.classList.add(cls)
  node._once = setTimeout(() => { node.classList.remove(cls); node._once = null }, ms)
}

// The effects layer sits above everything; what it holds is short-lived.
function fxLayer(svg) {
  return svg.querySelector('.ff-fx') || el('g', { class: 'ff-fx', 'pointer-events': 'none' }, svg)
}
// Leaves (or petals) shaken loose: a handful of specks that tumble down,
// drifting a little sideways, and LAND — on the ground at the foot of
// whatever shed them, where they lie for a few seconds before they fade.
// Each speck gets its own drift, spin and fall as CSS variables so one
// keyframe set serves them all; the fall's length sets its time, so a
// leaf from a tall canopy takes longer than one from a bush.
const REST_MS = 7000
function shed(svg, x, y, n, fill, spread = 24, seed = 0, groundY = y) {
  const fx = fxLayer(svg)
  const made = []
  const ground = Math.min(486, groundY)
  for (let i = 0; i < n; i++) {
    const j = (k) => jitter(seed * 17 + i * 5 + k)
    const cy = y + (j(2) - 0.5) * spread * 0.5
    const land = ground + (j(5) - 0.5) * 6
    const dist = Math.max(8, land - cy)
    const c = el('circle', {
      class: 'ff-shed',
      cx: (x + (j(1) - 0.5) * spread).toFixed(1), cy: cy.toFixed(1),
      r: (1.8 + j(3) * 1.8).toFixed(1), opacity: '.95', 'data-ground': land.toFixed(1),
    }, fx)
    c.style.fill = fill
    c.style.setProperty('--dx', `${((j(4) - 0.5) * Math.min(60, 16 + dist * 0.5)).toFixed(0)}px`)
    c.style.setProperty('--dy', `${dist.toFixed(1)}px`)
    c.style.setProperty('--rot', `${(180 + j(6) * 300).toFixed(0)}deg`)
    c.style.animationDuration = `${(0.5 + dist / 110 + j(7) * 0.3).toFixed(2)}s, ${REST_MS}ms`
    c.style.animationDelay = `${(j(8) * 0.12).toFixed(2)}s, 0s`
    made.push(c)
  }
  setTimeout(() => made.forEach((c) => c.remove()), REST_MS + 200)
}
// Rings spreading over the pond.
function ripple(svg, x, y) {
  const fx = fxLayer(svg)
  const made = []
  for (let i = 0; i < 3; i++) {
    const e = el('ellipse', { class: 'ff-ripple', cx: x, cy: y, rx: 6, ry: 2.2, fill: 'none', stroke: 'var(--ff-pond-hi)', 'stroke-width': '1.6' }, fx)
    e.style.animationDelay = `${i * 0.22}s`
    made.push(e)
  }
  setTimeout(() => made.forEach((c) => c.remove()), 1800)
}
// Smoke from the cabin's roof.
function puff(svg, x, y) {
  const fx = fxLayer(svg)
  const made = []
  for (let i = 0; i < 3; i++) {
    const c = el('circle', { class: 'ff-puff', cx: x + i * 2, cy: y, r: 3 + i, fill: 'var(--ff-stone)', opacity: '.6' }, fx)
    c.style.animationDelay = `${i * 0.3}s`
    made.push(c)
  }
  setTimeout(() => made.forEach((c) => c.remove()), 2400)
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
  // Clamped above the foreground grass band, which starts at y=490.
  return { x: Math.min(950, Math.max(50, x)), y: Math.min(482, Math.max(398, y)) }
}

const sessionLines = (s, fallbackCat) => {
  const mins = durationMin(s)
  const alignTxt = s.avg_align == null ? 'ALIGN —' : `ALIGN ${Math.round(s.avg_align * 100)}%`
  const cat = sessionCategory(s) || fallbackCat || 'Uncategorized'
  return [s.text, `${cat} · ${fmtDate(s.started_at)}`, `${mins} min · ${alignTxt} · ${isWatering(s) ? 'a watering' : 'not a watering'}`]
}

// api: { pin(story), lit(id) -> bool, toggleLit(id) } — the React side of
// the scene, reached through a ref so a pin never re-renders the SVG.
function renderEcosystem(svg, tip, life, uid, seedOff, api) {
  svg.replaceChildren()
  defsFor(svg, uid)
  drawBackdrop(svg, uid, seedOff)
  svg.addEventListener('pointerleave', () => { tip.style.display = 'none' })
  const earned = FEATURES.filter((f) => f.test(life))
  const p = life.project

  // Landmarks: each in its own group that can be hovered, focused and
  // clicked. The pond ripples, the lantern and the cabin light up and
  // stay lit, the bench calls the rabbit over; every one tells how it was
  // earned and pins that story.
  const reactions = {}   // filled once the critters exist
  earned.filter((f) => f.spot).forEach((f) => {
    const [x, y] = f.spot
    const g = el('g', { class: 'ff-landmark', 'data-landmark': f.id, tabindex: '0', 'aria-label': `${f.name}, earned at ${f.what}` }, svg)
    drawLandmark(g, uid, f.id, x, y)
    const flame = g.querySelector('circle[fill="#FFD98A"]')
    if (flame) flame.classList.add('ff-flame')
    if (LIGHTABLE.has(f.id) && api.lit(f.id)) g.classList.add('ff-lit')
    const by = earnedBy(f, life)
    const story = () => ({
      kind: 'landmark', title: f.name, f,
      lines: [
        `${f.what} · earned ${by ? fmtDate(by.ended_at || by.started_at) : 'in this life'}`,
        by ? `Earned with “${by.text}”, ${durationMin(by)} min at ${by.avg_align == null ? '—' : Math.round(by.avg_align * 100) + '%'} align.` : '',
        LIGHTABLE.has(f.id) ? (g.classList.contains('ff-lit') ? 'Lit tonight.' : 'Dark. Click to light it.') : '',
      ].filter(Boolean),
    })
    attachTip(g, svg, tip, () => [f.name, `${f.what} · earned ${by ? fmtDate(by.ended_at || by.started_at) : 'in this life'}`, by ? `with “${by.text}”` : ''].filter(Boolean), {
      hint: () => (f.id === 'pond' ? 'Click to stir the water'
        : f.id === 'lantern' ? (g.classList.contains('ff-lit') ? 'Lit. Click to put the light out' : 'Click to light it')
        : f.id === 'cabin' ? (g.classList.contains('ff-lit') ? 'The window is lit. Click to put the light out' : 'Click to light the window')
        : 'Click to sit a while'),
      onClick: () => {
        if (f.id === 'pond') ripple(svg, x - 10, y - 2)
        else if (LIGHTABLE.has(f.id)) {
          api.toggleLit(f.id)
          g.classList.toggle('ff-lit', api.lit(f.id))
          if (f.id === 'cabin' && g.classList.contains('ff-lit')) puff(svg, x, y - 46)
        } else if (f.id === 'bench' && reactions.rabbit) reactions.rabbit()
        api.pin(story())
      },
    })
  })

  const fgBand = el('ellipse', { cx: 500, cy: 600, rx: 860, ry: 110, fill: 'var(--ff-fg-band)', opacity: '.85', filter: `url(#rough${uid})` }, svg)
  const layer = []   // { y, node } sorted back to front

  // Prior lives: snags standing back where the old trees were.
  const snagSpots = [[300, 438], [712, 442], [232, 462], [770, 466], [420, 432], [590, 434]]
  for (let k = 0; k < Math.min(life.snags, snagSpots.length); k++) {
    const [x, y] = snagSpots[k]
    const g = el('g', { class: 'ff-tree ff-snag-tree', transform: `translate(${x},${y})`, tabindex: '0', 'aria-label': 'a withered tree from an earlier life of this project' })
    const snag = drawSnag(0.6 + jitter(seedOff + k) * 0.2, seedOff + k)
    g.appendChild(snag)
    const lines = () => ['An earlier tree', `Withered after ${DEAD_DAYS} days without a watering.`]
    attachTip(g, svg, tip, lines, {
      onClick: () => { playOnce(snag.querySelector('.ff-rustle'), 'ff-rustling', 800); api.pin({ kind: 'snag', title: 'An earlier tree', lines: [`Withered after ${DEAD_DAYS} days without a watering. The tree that stands now grew from the next good session.`] }) },
    })
    layer.push({ y, node: g })
  }

  // The project itself.
  const sp = speciesFor(p.category || (life.rows.length ? sessionCategory(life.rows[life.rows.length - 1]) : null))
  const sc = treeScale(life)
  const center = el('g', {
    class: `ff-tree ff-center ff-${life.state}`, transform: 'translate(500,476)', tabindex: '0',
    'aria-label': `${p.name}, ${STATES[life.state].label}`,
  })
  const fill = treeFill(sp.kind, life)
  const tree = life.state === 'dead'
    ? drawSnag(Math.max(sc, 0.9), seedOff + 99)
    : drawTree(sp.kind, fill, sc, uid, seedOff + 99, treeGrowth(life))
  tree.querySelector('.ff-sway > g')?.classList.add('ff-canopy')
  center.appendChild(tree)
  const treeLines = () => {
    const n = life.lifeWaterings.length
    const last = life.lifeWaterings.length ? `last watered ${fmtDate(life.lifeWaterings[n - 1].ended_at)}` : 'never watered'
    const lines = [p.name, `${STATES[life.state].label} · ${n} watering${n === 1 ? '' : 's'} · ${life.hours.toFixed(1)} h this life`, last]
    if (life.state === 'seedling') lines[2] = `Waiting for its first watering: a session at ${Math.round(WATER_MIN_ALIGN * 100)}%+ align.`
    if (life.state === 'dead') lines[2] = 'The next good session plants a new tree here.'
    return lines
  }
  attachTip(center, svg, tip, treeLines, {
    hint: life.state === 'dead' ? 'Click to hear its story' : 'Click to shake it',
    onClick: () => {
      if (life.state === 'dead') playOnce(tree.querySelector('.ff-rustle'), 'ff-rustling', 800)
      else {
        playOnce(center, 'ff-shaking', 900)
        const perch = tree.perch || { x: 0, y: -52 * sc }
        shed(svg, 500 + perch.x * 0.3, 476 + perch.y + 14 * sc, 10 + Math.round(sc * 3), fill, 70 * sc, seedOff + 5, 478)
        if (reactions.bird) reactions.bird()
        if (reactions.rabbit) reactions.rabbit()
      }
      const nx = nextFeature(life)
      const lines = treeLines().slice(1)
      if (life.state !== 'dead' && life.state !== 'dormant') {
        lines.push(nx ? `${nx.f.name} comes at ${nx.f.what}: ${nx.left} to go.` : 'Every landmark is here. The clearing is complete.')
      }
      api.pin({ kind: 'tree', title: p.name, lines })
    },
  })
  layer.push({ y: 476, node: center })

  // Sessions of the current life, oldest nearest the tree. The spiral says
  // where each one would like to stand; the ground says where it can. A
  // plant never lands on the tree, on an earned landmark (a bush in the
  // pond, a bush on the bench) or on another plant: each one tries up to
  // thirty spots — the same ring at other angles, then wider rings — and
  // keeps the first with daylight around it, or failing that the roomiest.
  const obstacles = []
  earned.filter((f) => f.spot).forEach((f) => obstacles.push({ x: f.spot[0], y: f.spot[1], r: f.spot[2] }))
  const placed = []
  // The tree is not a circle on the ground: anything standing behind it is
  // behind the whole canopy, which hides a plant anywhere under its width.
  // In front of the trunk a plant only needs to clear the base.
  const treeRoom = (x, y, r) => (y <= 480
    ? Math.abs(x - 500) - (34 * sc + r)
    : Math.hypot(x - 500, (y - 476) * 2) - (12 * sc + r))
  const roomAt = (x, y, r) => {
    let gap = treeRoom(x, y, r)
    for (const o of obstacles) gap = Math.min(gap, Math.hypot(o.x - x, (o.y - y) * 2) - (o.r + r))
    for (const q of placed) gap = Math.min(gap, Math.hypot(q.x - x, (q.y - y) * 1.6) - (q.r + r))
    return gap
  }
  life.lifeRows.forEach((s, i) => {
    const kind = elementKind(s)
    const mins = durationMin(s)
    const esc = 1.05 + Math.min(1, mins / 120) * 0.6
    const pr = 11 * esc
    let best = null
    for (let k = 0; k < 30; k++) {
      const spread = 1 + Math.floor(k / 10) * 0.18
      const c = spiralSpot(i, seedOff + k * 131, spread)
      const gap = roomAt(c.x, c.y, pr)
      if (best === null || gap > best.gap) best = { x: c.x, y: c.y, gap }
      if (gap >= 3) break
    }
    placed.push({ x: best.x, y: best.y, r: pr })
    const { x, y } = best
    const pfill = foliageFill(speciesFor(sessionCategory(s) || p.category).kind, s.avg_align)
    const g = el('g', {
      class: `ff-tree ff-plant ff-plant-${kind}`, transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, tabindex: '0',
      'aria-label': `${s.text}, ${ELEMENT_LABEL[kind]}, ${mins} minutes`,
    })
    const plant = drawElement(kind, pfill, esc, i + seedOff)
    g.appendChild(plant)
    const rustle = plant.querySelector('.ff-rustle')
    attachTip(g, svg, tip, () => sessionLines(s, p.category), {
      hint: 'Click to see this session',
      onEnter: () => playOnce(rustle, 'ff-rustling', 800),
      onClick: () => {
        playOnce(rustle, 'ff-rustling', 800)
        if (kind !== 'stone') shed(svg, x, y - 12 * esc, kind === 'bloom' ? 8 : 5, kind === 'bloom' ? 'var(--ff-bloom)' : pfill, 22 * esc, i + seedOff, y + 2)
        api.pin({
          kind: 'session', title: s.text, s,
          lines: [
            `${sessionCategory(s) || p.category || 'Uncategorized'} · ${fmtDate(s.started_at)} · ${mins} min · ${s.avg_align == null ? 'unscored' : `ALIGN ${Math.round(s.avg_align * 100)}%`}`,
            isWatering(s)
              ? `A watering: it kept ${p.name} green${kind === 'bloom' ? ', and grew into a flowering bush' : ''}.`
              : `Not a watering (under ${Math.round(WATER_MIN_ALIGN * 100)}% align): it counts as hours, not water, and grew into a ${ELEMENT_LABEL[kind]}.`,
          ],
        })
      },
    })
    layer.push({ y, node: g })
  })

  layer.sort((a, b) => a.y - b.y).forEach(({ node }) => svg.insertBefore(node, fgBand))
  const critters = el('g', {}, svg)
  const critterStory = (f, byTxt) => ({ kind: 'critter', title: f.name, lines: [`Came at ${f.what}${byTxt}.`, f.id === 'bird' ? 'It stays as long as the tree is green. Shake the tree and it takes off — and comes back.' : 'It lives under the bench side of the clearing and bolts when the tree shakes.'] })
  if (earned.some((f) => f.id === 'bird') && life.state !== 'dead') {
    // On the canopy, where this tree says its top is; the belly sits on it.
    const perch = tree.perch || { x: 14 * sc, y: -52 * sc }
    const bsc = 0.9 + sc * 0.3
    const f = FEATURES[0]
    const by = earnedBy(f, life)
    const byTxt = by ? `, ${fmtDate(by.ended_at || by.started_at)}` : ''
    const spot = drawBird(critters, 500 + perch.x, 476 + perch.y - 3.2 * bsc, bsc)
    const flyer = spot.querySelector('.ff-flyer')
    reactions.bird = () => playOnce(flyer, 'ff-startled', 2400)
    attachTip(spot, svg, tip, () => [f.name, `${f.what}${byTxt}`], {
      hint: 'Click to startle it',
      onClick: () => { reactions.bird(); api.pin(critterStory(f, byTxt)) },
    })
  }
  if (earned.some((f) => f.id === 'rabbit')) {
    const f = FEATURES[2]
    const by = earnedBy(f, life)
    const byTxt = by ? `, ${fmtDate(by.ended_at || by.started_at)}` : ''
    const spot = drawRabbit(critters, 610, 500, 1.1)
    const hopper = spot.querySelector('.ff-hopper')
    reactions.rabbit = () => playOnce(hopper, 'ff-hopping', 1300)
    attachTip(spot, svg, tip, () => [f.name, `${f.what}${byTxt}`], {
      hint: 'Click and it bolts',
      onClick: () => { reactions.rabbit(); api.pin(critterStory(f, byTxt)) },
    })
  }
  fxLayer(svg)
  growIn(svg, `${p.id}:${life.lifeRows.length}:${life.state}:${life.snags}`)
}

// The wilds: sessions filed under no project, each its own small tree, kept
// so nothing already grown disappears — and so filing one is a visible upgrade.
function renderWilds(svg, tip, rows, uid, seedOff, api) {
  svg.replaceChildren()
  defsFor(svg, uid)
  drawBackdrop(svg, uid, seedOff)
  svg.addEventListener('pointerleave', () => { tip.style.display = 'none' })
  const fgBand = el('ellipse', { cx: 500, cy: 600, rx: 860, ry: 110, fill: 'var(--ff-fg-band)', opacity: '.85', filter: `url(#rough${uid})` }, svg)
  const layer = []
  // A whole hillside, not a clearing: the wild trees take the same scattered
  // stand the month groves use, oldest toward the back ridge and newest
  // toward the front, each standing on the terrain curve. Depth sets size,
  // so the back slope reads as distance.
  const yTop = (x) => hillY(x, 500, 385, 480, 105) + 8
  const yBot = (x) => Math.min(482, hillY(x, 500, 655, 840, 205) + 20)
  const N = rows.length
  const placed = []
  rows.forEach((s, i) => {
    const mins = durationMin(s)
    const tmin = Math.max(0, 0.5 - N * 0.05)
    const target = N > 1 ? tmin + (1 - tmin) * (i / (N - 1)) : 0.85
    let best = null
    for (let k = 0; k < 40; k++) {
      const cx = 50 + jitter(seedOff * 7 + i * 53 + k * 11 + 1) * 900
      const t = Math.max(0, Math.min(1, target + (jitter(seedOff * 7 + i * 53 + k * 11 + 2) - 0.5) * 0.7))
      const top = yTop(cx), bot = yBot(cx)
      const cy = top + (bot - top) * t
      const size = (0.55 + 0.45 * t) * (0.55 + Math.min(1, mins / 120) * 0.35)
      const r = 24 * size
      let gap = Infinity
      for (const q of placed) gap = Math.min(gap, Math.hypot(q.x - cx, (q.y - cy) * 1.6) - (q.r + r))
      if (best === null || gap > best.gap) best = { x: cx, y: cy, size, r, gap }
      if (gap >= 4) break
    }
    placed.push({ x: best.x, y: best.y, r: best.r })
    const { x, y, size } = best
    const sp = speciesFor(sessionCategory(s))
    const sc = size
    const g = el('g', {
      class: 'ff-tree', transform: `translate(${x.toFixed(1)},${y.toFixed(1)})`, tabindex: '0',
      'aria-label': `${s.text}, ${sp.label}, ${mins} minutes`,
    })
    const fill = foliageFill(sp.kind, s.avg_align)
    const tree = drawTree(sp.kind, fill, sc, uid, i + seedOff)
    tree.querySelector('.ff-sway > g')?.classList.add('ff-canopy')
    g.appendChild(tree)
    attachTip(g, svg, tip, () => {
      const alignTxt = s.avg_align == null ? 'ALIGN —' : `ALIGN ${Math.round(s.avg_align * 100)}%`
      return [s.text, `${sp.label} · ${fmtDate(s.started_at)}`, `${mins} min · ${alignTxt}`]
    }, {
      hint: 'Click to shake it',
      onClick: () => {
        playOnce(g, 'ff-shaking', 900)
        const perch = tree.perch || { x: 0, y: -40 * sc }
        shed(svg, x + perch.x * 0.3, y + perch.y + 10 * sc, 6, fill, 40 * sc, i + seedOff, y + 2)
        api.pin({
          kind: 'wild', title: s.text, s,
          lines: [
            `${sp.label} · ${fmtDate(s.started_at)} · ${mins} min · ${s.avg_align == null ? 'unscored' : `ALIGN ${Math.round(s.avg_align * 100)}%`}`,
            isWatering(s) ? 'Filed under a project, this session would water its tree.' : 'Filed under a project, this session would count as hours there, not water.',
          ],
        })
      },
    })
    layer.push({ y, node: g })
  })
  layer.sort((a, b) => a.y - b.y).forEach(({ node }) => svg.insertBefore(node, fgBand))
  fxLayer(svg)
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

// The story a click pinned under a scene: what it was, in a few lines, and
// the one action that belongs to it (refiling a session). Escape, or the
// close button, lets it go.
function PinCard({ story, onClose, onPick }) {
  useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const canRefile = (story.kind === 'session' || story.kind === 'wild') && onPick && isMonitorLive()
  return (
    <div className="ff-pin mt-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm" role="status">
      <div className="flex items-start gap-3">
        <div className="grow min-w-0">
          <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{story.title}</p>
          {story.lines.map((l, i) => <p key={i} className="text-slate-500 dark:text-slate-400 tabular-nums">{l}</p>)}
        </div>
        <div className="flex items-center gap-3 flex-none">
          {canRefile && (
            <button
              type="button"
              onClick={() => onPick(story.s)}
              className="rounded-md bg-emerald-500 px-3 py-1 font-medium text-white hover:bg-emerald-600"
            >
              {story.kind === 'wild' ? 'File it…' : 'Refile…'}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none">×</button>
        </div>
      </div>
    </div>
  )
}

// Everything a scene needs from React, as one stable object, so the SVG
// is only redrawn when the life itself changes.
function useSceneApi(key) {
  const [pinned, setPinned] = useState(null)
  const [api] = useState(() => ({
    pin: (story) => setPinned(story),
    lit: (id) => !!readLit()[`${key}:${id}`],
    toggleLit: (id) => {
      const map = readLit()
      const k = `${key}:${id}`
      if (map[k]) delete map[k]; else map[k] = true
      writeLit(map)
    },
  }))
  return [api, pinned, setPinned]
}

function Ecosystem({ life, idx, onPick }) {
  const svgRef = useRef(null)
  const tipRef = useRef(null)
  const sectionRef = useRef(null)
  const [api, pinned, setPinned] = useSceneApi(`p${life.project.id}`)
  useEffect(() => {
    renderEcosystem(svgRef.current, tipRef.current, life, 'p' + life.project.id, life.project.id * 41, api)
    setPinned(null)
  }, [life, api, setPinned])
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
        {pinned
          ? <PinCard story={pinned} onClose={() => setPinned(null)} onPick={onPick} />
          : <p className="mt-1 text-[15px] italic font-serif text-slate-500 dark:text-slate-400">{whisperFor(life)}</p>}
      </div>
    </section>
  )
}

function Wilds({ rows, onPick }) {
  const svgRef = useRef(null)
  const tipRef = useRef(null)
  const sectionRef = useRef(null)
  const [api, pinned, setPinned] = useSceneApi('wilds')
  useEffect(() => { renderWilds(svgRef.current, tipRef.current, rows, 'wild', 977, api); setPinned(null) }, [rows, api, setPinned])
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
          <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">{rows.length} sessions · {hrs.toFixed(1)} h</span>
        </div>
        {pinned
          ? <PinCard story={pinned} onClose={() => setPinned(null)} onPick={onPick} />
          : (
            <p className="mt-1 text-[15px] italic font-serif text-slate-500 dark:text-slate-400">
              Sessions that belong to no project grow wild. Click one to see it, and file it under a project from there — it waters that tree.
            </p>
          )}
      </div>
    </section>
  )
}

const ORDER = { thriving: 0, fading: 1, wilting: 2, seedling: 3, dead: 4, dormant: 5 }
const HOUR = 3600000
const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

// underForest: the panel's refile card, rendered right under the scroller.
export default function ProjectForest({ projects, sessions, onPick, underForest = null }) {
  // One clock per mount: health is a function of "now", and a page left open
  // overnight should not re-rank its ecosystems under the reader's cursor.
  const [realNow] = useState(() => Date.now())
  // The scrubber's clock, when it is not today. Every tick redraws every
  // scene; the browser already coalesces a drag to one input per frame.
  const [at, setAt] = useState(null)
  const now = at ?? realNow
  const scrollerRef = useRef(null)
  const [activeKey, setActiveKey] = useState(null)

  const allRows = useMemo(() => (sessions || []).filter((s) => s.started_at && s.ended_at), [sessions])
  // Where the scrubber can go: from the first thing that happened to today.
  const earliest = useMemo(() => {
    let t = Infinity
    for (const s of allRows) t = Math.min(t, parseTs(s.started_at).getTime() || Infinity)
    for (const p of projects || []) t = Math.min(t, parseTs(p.created_at).getTime() || Infinity)
    return Number.isFinite(t) ? Math.min(t, realNow - DAY) : null
  }, [allRows, projects, realNow])
  // The ecosystems keep today's order while the scrubber runs, so the one
  // under the reader's cursor does not move when its state changes.
  const todayOrder = useMemo(() => {
    const lives = (projects || []).map((p) => projectLife(p, allRows, realNow))
    lives.sort((a, b) => (ORDER[a.state] - ORDER[b.state]) || (b.lastT - a.lastT))
    return new Map(lives.map((l, i) => [l.project.id, i]))
  }, [projects, allRows, realNow])

  const { lives, wilds } = useMemo(() => {
    const rows = at == null ? allRows : allRows.filter((s) => endT(s) <= now)
    const projs = (projects || []).filter((p) => at == null || !(parseTs(p.created_at).getTime() > now))
    const lives = projs.map((p) => projectLife(p, rows, now))
    lives.sort((a, b) => (todayOrder.get(a.project.id) ?? 0) - (todayOrder.get(b.project.id) ?? 0))
    const known = new Set(projs.map((p) => p.id))
    const wilds = rows.filter((s) => s.project_id == null || !known.has(s.project_id))
      .sort((a, b) => (a.started_at < b.started_at ? -1 : 1))
    return { lives, wilds }
  }, [projects, allRows, now, at, todayOrder])

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
  // Synchronous on purpose: deferring the state (a frame, a timer) lets
  // React snap the controlled slider back to the old value between one
  // input event and the next, and the thumb fights the hand dragging it.
  const scrubTo = (t) => setAt(t >= realNow - HOUR ? null : t)

  if (!lives.length && !wilds.length && at == null) {
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

      <EdgeArrows scrollerRef={scrollerRef} />
      <div ref={scrollerRef} className="ff-scroller">
        {lives.map((l, i) => <Ecosystem key={l.project.id} life={l} idx={i} onPick={onPick} />)}
        {wilds.length > 0 && <Wilds rows={wilds} onPick={onPick} />}
        {!lives.length && !wilds.length && (
          <div className="ff-grove flex items-center justify-center p-10 text-slate-500 dark:text-slate-400 italic font-serif">Nothing had grown yet.</div>
        )}
      </div>

      {earliest != null && (
        <div className="ff-scrub mt-3 flex items-center gap-3 flex-wrap text-sm">
          <span className="ff-when font-semibold text-slate-700 dark:text-slate-200 tabular-nums min-w-[9.5rem]">
            {at == null ? 'Today' : `As of ${fmtDay(at)}`}
          </span>
          <input
            type="range"
            aria-label="Replay the forest's history"
            min={earliest} max={realNow} step={HOUR}
            value={now}
            onChange={(e) => scrubTo(Number(e.target.value))}
            className="grow min-w-[12rem] accent-emerald-500"
          />
          {at != null
            ? <button type="button" onClick={() => setAt(null)} className="text-emerald-600 dark:text-emerald-400 underline underline-offset-4">Back to today</button>
            : <span className="text-xs text-slate-400 dark:text-slate-500">Drag back to watch the forest grow</span>}
        </div>
      )}
      {underForest}

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
            <li><span className="font-semibold text-slate-700 dark:text-slate-200">Flowering bush</span> · {BLOOM_MIN} minutes or more at {Math.round(BLOOM_ALIGN * 100)}%+ align</li>
            <li><span className="font-semibold text-slate-700 dark:text-slate-200">Bush</span> · a watering: {Math.round(WATER_MIN_ALIGN * 100)}%+ align</li>
            <li><span className="font-semibold text-slate-700 dark:text-slate-200">Fern</span> · finished, but drifting; counts as hours, not water</li>
            <li><span className="font-semibold text-slate-700 dark:text-slate-200">Stone</span> · finished, mostly off intention</li>
          </ul>
          <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">Longer sessions grow bigger plants. The tree itself grows with the hours of its current life. Click anything to hear its story; shake a tree and see who lives in it.</p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 rounded-lg shadow-md p-5 flex flex-col">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 mb-3">A kept tree draws company</p>
          <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1.5 grow">
            {FEATURES.map((f) => <li key={f.id}><span className="font-semibold text-slate-700 dark:text-slate-200">{f.name}</span> · {f.what}</li>)}
          </ul>
          <div className="flex items-end gap-3 mt-2">
            <Mini kind="leaf" align={0.9} sc={0.42} w={48} h={44} />
            <Mini kind="leaf" align={0.9} sc={0.62} w={60} h={60} />
            <span className="text-[11px] text-slate-400 dark:text-slate-500 pb-1">Counted within the tree's current life. The lantern and the cabin light up when you click them.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Colours the ecosystems add to the shared forest palette, and the motion
// the pointer sets off. One-shot reactions live on their own wrapper
// elements (see drawElement, drawBird, drawRabbit): a rustle on .ff-rustle
// inside the growing .ff-grow, the bird's loop on .ff-flyer around its
// perched idle, the rabbit's bolt on .ff-hopper around its hop idle, the
// shake on the tree's .ff-canopy under the swaying group.
const ECO_CSS = `
.ff-root{--ff-snag:#7A6653; --ff-bloom:#EE6FA3; --ff-bloom-heart:#FFF2C9; --ff-bird:#3F4A3B; --ff-fur:#C9B79A}
.dark .ff-root{--ff-snag:#4E4036; --ff-bloom:#F08DBB; --ff-bloom-heart:#FFE7A6; --ff-bird:#8E9A8A; --ff-fur:#7C7160}
.ff-wilting .ff-sway [style]{opacity:.55}
.ff-dormant .ff-sway [style]{opacity:.7}
.ff-dormant .ff-sway,.ff-wilting .ff-sway{animation:none}
.ff-critter,.ff-landmark{cursor:pointer}
/* No box around a clicked thing, ever: the story card is the feedback. */
.ff-landmark:focus,.ff-critter:focus,.ff-tree:focus{outline:none}
.ff-perched,.ff-perched-head,.ff-perched-tail,.ff-perched-wing,.ff-rabbit,.ff-rabbit-ear{transform-box:fill-box; animation-play-state:paused}
.ff-live .ff-perched,.ff-live .ff-perched-head,.ff-live .ff-perched-tail,.ff-live .ff-perched-wing,.ff-live .ff-rabbit,.ff-live .ff-rabbit-ear{animation-play-state:running}
.ff-perched{transform-origin:50% 100%; animation:ff-perched-bob 4.3s ease-in-out infinite}
@keyframes ff-perched-bob{0%,64%,80%,100%{transform:translateY(0)} 68%{transform:translateY(-1.6px)} 72%{transform:translateY(0)} 76%{transform:translateY(-1px)}}
.ff-perched-head{transform-origin:0% 100%; animation:ff-perched-peck 5.3s ease-in-out infinite}
@keyframes ff-perched-peck{0%,24%,40%,100%{transform:rotate(0)} 28%{transform:rotate(24deg)} 32%{transform:rotate(2deg)} 36%{transform:rotate(20deg)}}
.ff-perched-tail{transform-origin:100% 50%; animation:ff-perched-tail 6.1s ease-in-out infinite; animation-delay:-2.2s}
@keyframes ff-perched-tail{0%,50%,62%,100%{transform:rotate(0)} 54%{transform:rotate(-26deg)} 58%{transform:rotate(6deg)}}
.ff-perched-wing{transform-origin:50% 0%; animation:ff-perched-wing 7.9s ease-in-out infinite; animation-delay:-4s}
@keyframes ff-perched-wing{0%,70%,84%,100%{transform:rotate(0)} 74%{transform:rotate(-38deg)} 78%{transform:rotate(-6deg)} 81%{transform:rotate(-30deg)}}
.ff-rabbit{transform-origin:50% 100%; animation:ff-rabbit-hop 13s ease-in-out infinite}
@keyframes ff-rabbit-hop{
  0%,52%{transform:translate(0,0) scaleX(1)}
  55%{transform:translate(6px,-7px) scaleX(1)} 58%{transform:translate(12px,0) scaleX(1)}
  61%{transform:translate(18px,-7px) scaleX(1)} 64%{transform:translate(24px,0) scaleX(1)}
  72%{transform:translate(24px,0) scaleX(1)} 74%{transform:translate(24px,0) scaleX(-1)}
  77%{transform:translate(18px,-7px) scaleX(-1)} 80%{transform:translate(12px,0) scaleX(-1)}
  83%{transform:translate(6px,-7px) scaleX(-1)} 86%{transform:translate(0,0) scaleX(-1)}
  94%{transform:translate(0,0) scaleX(-1)} 96%,100%{transform:translate(0,0) scaleX(1)}
}
.ff-rabbit-ear{transform-origin:50% 100%; animation:ff-rabbit-ear 4.7s ease-in-out infinite}
.ff-rabbit-ear-b{animation-duration:6.1s; animation-delay:-2.3s}
@keyframes ff-rabbit-ear{0%,40%,52%,100%{transform:rotate(0)} 44%{transform:rotate(-14deg)} 48%{transform:rotate(8deg)}}

/* A bush under the pointer: a quick shiver that settles, from the roots. */
.ff-rustle{transform-box:fill-box; transform-origin:50% 100%}
.ff-rustle.ff-rustling{animation:ff-rustle .8s ease-out}
@keyframes ff-rustle{
  0%{transform:skewX(0) scale(1,1)} 12%{transform:skewX(7deg) scale(1.04,.96)} 30%{transform:skewX(-6deg) scale(.98,1.03)}
  48%{transform:skewX(4deg) scale(1.02,.99)} 66%{transform:skewX(-2.5deg)} 82%{transform:skewX(1deg)} 100%{transform:skewX(0) scale(1,1)}
}
.ff-rustle[data-kind="stone"].ff-rustling{animation-name:ff-wobble; animation-duration:.6s}
.ff-rustle[data-kind="snag"].ff-rustling{animation-name:ff-wobble; animation-duration:.9s}
@keyframes ff-wobble{0%,100%{transform:rotate(0)} 25%{transform:rotate(-4deg)} 60%{transform:rotate(2.5deg)} 85%{transform:rotate(-1deg)}}
/* A shaken tree: the whole canopy whips and settles under its slow sway. */
.ff-canopy{transform-box:fill-box; transform-origin:50% 100%}
.ff-shaking .ff-canopy{animation:ff-shake .9s ease-out}
@keyframes ff-shake{
  0%{transform:rotate(0)} 10%{transform:rotate(-4deg) scale(1.02,.98)} 28%{transform:rotate(3.5deg) scale(.99,1.02)}
  46%{transform:rotate(-2.5deg)} 64%{transform:rotate(1.5deg)} 82%{transform:rotate(-.6deg)} 100%{transform:rotate(0)}
}
/* What a shake brings down, and what a click stirs up. */
/* The fall (transform) and the rest-then-fade (opacity) are two animations
   on the same speck, so a leaf stops where it lands and lies there. */
.ff-shed{transform-box:fill-box; transform-origin:center; animation:ff-shed 1.2s cubic-bezier(.3,.5,.7,1) forwards, ff-shed-rest 7s linear forwards}
@keyframes ff-shed{0%{transform:translate(0,0) rotate(0)} 100%{transform:translate(var(--dx,0px),var(--dy,60px)) rotate(var(--rot,280deg))}}
@keyframes ff-shed-rest{0%,70%{opacity:.95} 100%{opacity:0}}
.ff-ripple{transform-box:fill-box; transform-origin:center; animation:ff-ripple 1.5s ease-out forwards; opacity:0}
@keyframes ff-ripple{0%{opacity:.9; transform:scale(1)} 100%{opacity:0; transform:scale(9)}}
.ff-puff{transform-box:fill-box; transform-origin:center; animation:ff-puff 2s ease-out forwards; opacity:0}
@keyframes ff-puff{0%{opacity:.55; transform:translate(0,0) scale(.6)} 100%{opacity:0; transform:translate(10px,-34px) scale(2.2)}}
/* The bird's startled loop and the rabbit's bolt, on their own wrappers. */
.ff-flyer,.ff-hopper{transform-box:fill-box; transform-origin:50% 100%}
.ff-flyer.ff-startled{animation:ff-startle 2.4s ease-in-out}
@keyframes ff-startle{
  0%{transform:translate(0,0) rotate(0)} 14%{transform:translate(-16px,-30px) rotate(-14deg)} 38%{transform:translate(-54px,-46px) rotate(-4deg)}
  62%{transform:translate(-40px,-18px) rotate(8deg)} 84%{transform:translate(-8px,-8px) rotate(2deg)} 100%{transform:translate(0,0) rotate(0)}
}
.ff-startled .ff-perched-wing{animation:ff-flap .16s linear infinite; animation-play-state:running}
.ff-startled .ff-perched,.ff-startled .ff-perched-head,.ff-startled .ff-perched-tail{animation:none}
@keyframes ff-flap{0%,100%{transform:rotate(-40deg)} 50%{transform:rotate(16deg)}}
.ff-hopper.ff-hopping{animation:ff-bolt 1.3s ease-in-out}
@keyframes ff-bolt{
  0%{transform:translate(0,0) scaleX(1)} 12%{transform:translate(14px,-12px) scaleX(1)} 24%{transform:translate(28px,0) scaleX(1)}
  36%{transform:translate(42px,-12px) scaleX(1)} 48%{transform:translate(56px,0) scaleX(1)} 56%{transform:translate(56px,0) scaleX(-1)}
  68%{transform:translate(40px,-11px) scaleX(-1)} 80%{transform:translate(22px,0) scaleX(-1)} 92%{transform:translate(6px,-9px) scaleX(-1)} 100%{transform:translate(0,0) scaleX(1)}
}
/* A lit lantern or cabin window: full glow, and a flame that breathes. */
.ff-landmark.ff-lit{--ff-lantern-glow:1}
.ff-flame{transform-box:fill-box; transform-origin:center}
.ff-lit .ff-flame{animation:ff-flicker 2.2s ease-in-out infinite}
@keyframes ff-flicker{0%,100%{transform:scale(1); opacity:1} 30%{transform:scale(1.25); opacity:.85} 55%{transform:scale(1.08)} 75%{transform:scale(1.3); opacity:.9}}
@media (prefers-reduced-motion: reduce){
  .ff-perched,.ff-perched-head,.ff-perched-tail,.ff-perched-wing,.ff-rabbit,.ff-rabbit-ear{animation:none}
  .ff-rustle.ff-rustling,.ff-shaking .ff-canopy,.ff-flyer.ff-startled,.ff-hopper.ff-hopping,.ff-startled .ff-perched-wing,.ff-lit .ff-flame{animation:none}
  .ff-shed,.ff-puff{display:none}
}
`
