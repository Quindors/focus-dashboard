// Time display helpers. Callers pass minutes (events are converted upstream).

export function splitHM(minutes) {
  const total = Math.max(0, Math.round(minutes))
  return { h: Math.floor(total / 60), m: total % 60 }
}

// Compact "2h 17m" (or "17m" when under an hour) for inline/tooltip use.
export function fmtHM(minutes) {
  const { h, m } = splitHM(minutes)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// Clock style "2:30" (minutes zero-padded) for the donut center.
export function fmtClock(minutes) {
  const { h, m } = splitHM(minutes)
  return `${h}:${String(m).padStart(2, '0')}`
}
