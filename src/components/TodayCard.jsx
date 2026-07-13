function StatBlock({ value, label, accent = "text-slate-800 dark:text-slate-100" }) {
  return (
    <div>
      <div className={`text-4xl font-bold ${accent}`}>{value}</div>
      <div className="text-sm text-slate-500 dark:text-slate-400 mt-1">{label}</div>
    </div>
  )
}

export default function TodayCard({ today }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
        Today
      </h2>
      <div className="grid grid-cols-3 gap-6">
        <StatBlock
          value={`${today.productivePct}%`}
          label="productive"
          accent="text-emerald-600 dark:text-emerald-400"
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
