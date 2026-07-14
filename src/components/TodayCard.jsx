import { splitHM } from '../lib/format'

function PctStat({ pct }) {
  return (
    <div>
      <div className="text-4xl font-bold leading-none text-emerald-600 dark:text-emerald-400">{pct}%</div>
      <div className="text-sm text-slate-500 dark:text-slate-400 mt-2">productive</div>
    </div>
  )
}

// Stacked hrs / min with small unit labels above the numbers; auto-rolls to hours.
function TimeStat({ minutes, label, accent = "text-slate-800 dark:text-slate-100" }) {
  const { h, m } = splitHM(minutes)
  return (
    <div>
      <div className="flex gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-0.5">hrs</div>
          <div className={`text-3xl font-bold leading-none ${accent}`}>{h}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-0.5">min</div>
          <div className={`text-3xl font-bold leading-none ${accent}`}>{m}</div>
        </div>
      </div>
      <div className="text-sm text-slate-500 dark:text-slate-400 mt-2">{label}</div>
    </div>
  )
}

export default function TodayCard({ today }) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-4">
        Today
      </h2>
      <div className="grid grid-cols-3 gap-4 items-start">
        <PctStat pct={today.productivePct} />
        <TimeStat minutes={today.productiveMinutes} label="productive" accent="text-emerald-600 dark:text-emerald-400" />
        <TimeStat minutes={today.offTaskMinutes} label="off-task" accent="text-red-500 dark:text-red-400" />
      </div>
      <div className="mt-5 flex gap-2 text-xs text-slate-400 dark:text-slate-500">
        <span>{today.totalEvents} events</span>
        <span aria-hidden>·</span>
        <span>{today.offTaskEvents} off-task events</span>
      </div>
    </div>
  )
}
