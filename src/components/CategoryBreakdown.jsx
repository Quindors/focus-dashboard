import { PieChart, Pie, Cell, Tooltip, Legend, Label, ResponsiveContainer } from 'recharts'
import { useTheme } from '../theme'
import { fmtHM } from '../lib/format'

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
  const centerLabelColor = isDark ? '#94a3b8' : '#94a3b8'  // slate-400
  const centerValueColor = isDark ? '#f1f5f9' : '#1e293b'  // slate-100 / slate-800
  const cardClass = "bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors"

  // Screen-time label rendered in the donut hole.
  function renderCenter({ viewBox }) {
    const { cx, cy } = viewBox
    return (
      <g>
        <text x={cx} y={cy - 12} textAnchor="middle" fontSize="11" letterSpacing="0.05em" fill={centerLabelColor}>
          SCREEN TIME
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="26" fontWeight="700" fill={centerValueColor}>
          {fmtHM(totalMinutes)}
        </text>
      </g>
    )
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
      <ResponsiveContainer width="100%" height={340}>
        <PieChart>
          <Pie
            data={byCategory}
            dataKey="count"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={78}
            outerRadius={120}
            paddingAngle={2}
            labelLine={false}
          >
            {byCategory.map((entry, i) => (
              <Cell key={i} fill={colorFor(entry.isProductive, isDark)} stroke={sliceStroke} strokeWidth={2} />
            ))}
            <Label content={renderCenter} position="center" />
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            wrapperStyle={{ fontSize: 13 }}
            formatter={(value) => <span className="text-slate-600 dark:text-slate-300">{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
