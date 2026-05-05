import { useFocusData } from './hooks/useFocusData'
import TodayCard from './components/TodayCard'
import CategoryBreakdown from './components/CategoryBreakdown'
import WeeklyChart from './components/WeeklyChart'

function App() {
  const { data, error, loading } = useFocusData()

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-slate-800 mb-6">Focus Dashboard</h1>

        {loading && <p className="text-slate-500">Loading…</p>}
        {error && <p className="text-red-600">Error: {error}</p>}
        {data && (
          <div className="grid gap-6 md:grid-cols-2">
            <TodayCard today={data.today} />
            <WeeklyChart weekly={data.weekly} />
            <div className="md:col-span-2">
              <CategoryBreakdown byCategory={data.byCategory} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App