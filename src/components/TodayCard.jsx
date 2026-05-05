function StatBlock({ value, label, accent = "text-slate-800" }) {
  return (
    <div>
      <div className={`text-4xl font-bold ${accent}`}>{value}</div>
      <div className="text-sm text-slate-500 mt-1">{label}</div>
    </div>
  )
}

export default function TodayCard({ today }) {
  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
        Today
      </h2>
      <div className="grid grid-cols-3 gap-6">
        <StatBlock
          value={`${today.productivePct}%`}
          label="productive"
          accent="text-emerald-600"
        />
        <StatBlock
          value={today.productiveMinutes}
          label="productive minutes"
        />
        <StatBlock
          value={today.totalEvents}
          label="events"
        />
      </div>
    </div>
  )
}