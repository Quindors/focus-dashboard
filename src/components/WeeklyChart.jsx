import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useTheme } from '../theme'
import { fmtHM } from '../lib/format'

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const { dayLabel, date, productivePct, productiveEvents, totalEvents, productiveMinutes } = payload[0].payload
  return (
    <div className="bg-white dark:bg-slate-800 px-3 py-2 rounded shadow border border-slate-200 dark:border-slate-700 text-sm">
      <div className="font-semibold text-slate-800 dark:text-slate-100">{dayLabel} · {date}</div>
      <div className="text-slate-500 dark:text-slate-300">{productivePct}% productive</div>
      <div className="text-slate-500 dark:text-slate-300">{fmtHM(productiveMinutes)} productive</div>
      <div className="text-slate-400 dark:text-slate-500 text-xs">
        {productiveEvents} of {totalEvents} events
      </div>
    </div>
  )
}

export default function WeeklyChart({ weekly }) {
  const { isDark } = useTheme()
  const axis = isDark ? '#64748b' : '#94a3b8'
  const refLine = isDark ? '#334155' : '#cbd5e1'
  const cursor = isDark ? '#1e293b' : '#f1f5f9'

  const cardClass = "bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors"

  if (!weekly || weekly.length === 0) {
    return (
      <div className={cardClass}>
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
          This week
        </h2>
        <p className="text-slate-400 dark:text-slate-500 text-sm">No data yet.</p>
      </div>
    )
  }

  const activeDays = weekly.filter(d => d.totalEvents > 0)
  const avgPct = activeDays.length === 0
    ? 0
    : Math.round(activeDays.reduce((sum, d) => sum + d.productivePct, 0) / activeDays.length)

  return (
    <div className={cardClass}>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          This week
        </h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">avg {avgPct}%</span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={weekly} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <XAxis dataKey="dayLabel" stroke={axis} fontSize={12} />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            stroke={axis}
            fontSize={12}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: cursor }} />
          <ReferenceLine y={avgPct} stroke={refLine} strokeDasharray="4 4" />
          <Bar dataKey="productivePct" fill="#10b981" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
