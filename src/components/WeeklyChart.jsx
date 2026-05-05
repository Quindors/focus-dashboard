import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const { dayLabel, date, productivePct, productiveEvents, totalEvents } = payload[0].payload
  return (
    <div className="bg-white px-3 py-2 rounded shadow border border-slate-200 text-sm">
      <div className="font-semibold text-slate-800">{dayLabel} · {date}</div>
      <div className="text-slate-500">
        {productivePct}% productive
      </div>
      <div className="text-slate-400 text-xs">
        {productiveEvents} of {totalEvents} events
      </div>
    </div>
  )
}

export default function WeeklyChart({ weekly }) {
  if (!weekly || weekly.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
          This week
        </h2>
        <p className="text-slate-400 text-sm">No data yet.</p>
      </div>
    )
  }

  // Average across days that had any counted activity, for the reference line
  const activeDays = weekly.filter(d => d.totalEvents > 0)
  const avgPct = activeDays.length === 0
    ? 0
    : Math.round(activeDays.reduce((sum, d) => sum + d.productivePct, 0) / activeDays.length)

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
          This week
        </h2>
        <span className="text-xs text-slate-400">
          avg {avgPct}%
        </span>
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={weekly} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <XAxis dataKey="dayLabel" stroke="#94a3b8" fontSize={12} />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            stroke="#94a3b8"
            fontSize={12}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
          <ReferenceLine
            y={avgPct}
            stroke="#cbd5e1"
            strokeDasharray="4 4"
          />
          <Bar
            dataKey="productivePct"
            fill="#10b981"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}