import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

function colorFor(isProductive) {
  if (isProductive === true) return '#10b981'   // emerald-500
  if (isProductive === false) return '#ef4444'  // red-500
  return '#94a3b8'                              // slate-400
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const { name, count, minutes } = payload[0].payload
  return (
    <div className="bg-white px-3 py-2 rounded shadow border border-slate-200 text-sm">
      <div className="font-semibold text-slate-800">{name}</div>
      <div className="text-slate-500">{count} events · {minutes} min</div>
    </div>
  )
}

function renderLabel({ name, percent }) {
  // Hide label on tiny slices to avoid overlap
  if (percent < 0.05) return null
  return `${name} ${Math.round(percent * 100)}%`
}

export default function CategoryBreakdown({ byCategory }) {
  if (!byCategory || byCategory.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
          Today by category
        </h2>
        <p className="text-slate-400 text-sm">No data yet today.</p>
      </div>
    )
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
        Today by category
      </h2>
      <ResponsiveContainer width="100%" height={320}>
        <PieChart>
          <Pie
            data={byCategory}
            dataKey="count"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={110}
            label={renderLabel}
            labelLine={false}
          >
            {byCategory.map((entry, i) => (
              <Cell key={i} fill={colorFor(entry.isProductive)} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            wrapperStyle={{ fontSize: 13 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}