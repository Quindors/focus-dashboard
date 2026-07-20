import { useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { useTheme } from '../theme'
import { fmtHM, fmtClock } from '../lib/format'

const RADIAN = Math.PI / 180

function colorFor(isProductive, isDark) {
  if (isProductive === true) return '#10b981'   // emerald-500
  if (isProductive === false) return '#ef4444'  // red-500
  // neutral (Ambiguous / System): brighter in dark mode so it stays visible
  return isDark ? '#cbd5e1' : '#94a3b8'         // slate-300 / slate-400
}

// Hover readout pinned OUTSIDE the ring at the slice's mid-angle, so it never
// covers the donut or the center total.
function OutsideTooltip({ hover }) {
  if (!hover) return null
  const { name, count, minutes, x, y, onLeft } = hover
  return (
    <div
      className="absolute z-10 pointer-events-none bg-white dark:bg-slate-800 px-3 py-2 rounded shadow border border-slate-200 dark:border-slate-700 text-sm whitespace-nowrap"
      style={{
        left: x,
        top: y,
        transform: `translate(${onLeft ? '-100%' : '0'}, -50%)`,
      }}
    >
      <div className="font-semibold text-slate-800 dark:text-slate-100">{name}</div>
      <div className="text-slate-500 dark:text-slate-300">{count} events · {fmtHM(minutes)}</div>
    </div>
  )
}

export default function CategoryBreakdown({ byCategory, totalMinutes = 0 }) {
  const { isDark } = useTheme()
  const [hover, setHover] = useState(null)
  // Stroke each slice with the card background so the gap reads as a clean divider.
  const sliceStroke = isDark ? '#0f172a' : '#ffffff'  // slate-900 / white
  const cardClass = "bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors"

  // Recharts hands the hovered sector's geometry to onMouseEnter — project a
  // point just past the outer edge at the slice's mid-angle.
  function showHover(sector) {
    const { cx, cy, midAngle, outerRadius, name, count, minutes } = sector || {}
    if (cx == null || midAngle == null) return
    const r = (outerRadius || 124) + 12
    const cos = Math.cos(-midAngle * RADIAN)
    setHover({
      name,
      count,
      minutes,
      x: cx + r * cos,
      y: cy + r * Math.sin(-midAngle * RADIAN),
      onLeft: cos < 0,
    })
  }

  if (!byCategory || byCategory.length === 0) {
    return (
      <div className={cardClass}>
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
          Today by category
        </h2>
        <p className="text-slate-400 dark:text-slate-500 text-sm">No data yet today.</p>
      </div>
    )
  }

  return (
    <div className={cardClass}>
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
        Today by category
      </h2>

      {/* Donut with an HTML overlay centered in the hole (reliable across
          Recharts versions, unlike an SVG <Label>). */}
      <div className="relative">
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={byCategory}
              dataKey="count"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={82}
              outerRadius={124}
              paddingAngle={2}
              labelLine={false}
              onMouseEnter={(sector) => showHover(sector)}
              onMouseLeave={() => setHover(null)}
            >
              {byCategory.map((entry, i) => (
                <Cell key={i} fill={colorFor(entry.isProductive, isDark)} stroke={sliceStroke} strokeWidth={2} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <OutsideTooltip hover={hover} />

        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">Total time</div>
          <div className="text-3xl font-bold leading-none my-1 text-slate-800 dark:text-slate-100">
            {fmtClock(totalMinutes)}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500">hr:min</div>
        </div>
      </div>

      {/* Custom legend (so the donut fills the container and centering is exact). */}
      <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {byCategory.map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: colorFor(c.isProductive, isDark) }}
            />
            {c.name}
          </span>
        ))}
      </div>
    </div>
  )
}
