import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useTheme } from '../theme'
import { fmtHM, fmtClock } from '../lib/format'

function colorFor(isProductive, isDark) {
  if (isProductive === true) return '#10b981'   // emerald-500
  if (isProductive === false) return '#ef4444'  // red-500
  // neutral (Ambiguous / System): brighter in dark mode so it stays visible
  return isDark ? '#cbd5e1' : '#94a3b8'         // slate-300 / slate-400
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const { name, count, minutes } = payload[0].payload
  return (
    <div className="bg-white dark:bg-slate-800 px-3 py-2 rounded shadow border border-slate-200 dark:border-slate-700 text-sm">
      <div className="font-semibold text-slate-800 dark:text-slate-100">{name}</div>
      <div className="text-slate-500 dark:text-slate-300">{count} events · {fmtHM(minutes)}</div>
    </div>
  )
}

export default function CategoryBreakdown({ byCategory, totalMinutes = 0 }) {
  const { isDark } = useTheme()
  // Stroke each slice with the card background so the gap reads as a clean divider.
  const sliceStroke = isDark ? '#0f172a' : '#ffffff'  // slate-900 / white
  const cardClass = "bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors"

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
            >
              {byCategory.map((entry, i) => (
                <Cell key={i} fill={colorFor(entry.isProductive, isDark)} stroke={sliceStroke} strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} isAnimationActive={false} />
          </PieChart>
        </ResponsiveContainer>

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
