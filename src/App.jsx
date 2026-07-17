import { useEffect, useState } from 'react'
import { useFocusData } from './hooks/useFocusData'
import { useTheme } from './theme'
import TodayCard from './components/TodayCard'
import CategoryBreakdown from './components/CategoryBreakdown'
import WeeklyChart from './components/WeeklyChart'
import ReviewPanel from './components/ReviewPanel'

function TabBar({ tab, setTab }) {
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'review', label: 'Review' },
  ]
  return (
    <div className="flex gap-1 rounded-lg bg-slate-200/70 dark:bg-slate-800 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
            tab === t.id
              ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function ThemeToggle() {
  const { isDark, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
    >
      {isDark ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}

function LastUpdated({ at }) {
  const [, tick] = useState(0)
  // re-render every 5s so the "Xs ago" label stays fresh
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000)
    return () => clearInterval(id)
  }, [])
  if (!at) return null
  const secs = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000))
  const label = secs < 5 ? 'just now' : secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      updated {label}
    </span>
  )
}

function App() {
  const { data, error, loading, lastUpdated } = useFocusData()
  const [tab, setTab] = useState('overview')

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8 transition-colors">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100">Focus Dashboard</h1>
          <div className="flex items-center gap-4">
            <TabBar tab={tab} setTab={setTab} />
            <LastUpdated at={lastUpdated} />
            <ThemeToggle />
          </div>
        </div>

        {tab === 'overview' && (
          <>
            {loading && <p className="text-slate-500 dark:text-slate-400">Loading…</p>}
            {error && <p className="text-red-600 dark:text-red-400">Error: {error}</p>}
            {data && (
              <div className="grid gap-6 md:grid-cols-2">
                <TodayCard today={data.today} />
                <WeeklyChart weekly={data.weekly} />
                <div className="md:col-span-2">
                  <CategoryBreakdown byCategory={data.byCategory} totalMinutes={data.today.totalMinutes} />
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'review' && <ReviewPanel />}
      </div>
    </div>
  )
}

export default App
