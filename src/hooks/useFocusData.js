import { useEffect, useState } from 'react'
import { fetchFocusRows, fetchCategories } from '../lib/dataSource'

const ROWS_PER_MINUTE = 6  // decision_interval = 10s → 6 rows/min

// Polls the data source on an interval so the dashboard updates in near real
// time as the monitor writes new rows. The first load toggles `loading`;
// subsequent refreshes update silently and bump `lastUpdated`.
export function useFocusData(pollMs = 15000) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function fetchAll() {
      try {
        // Today's rows: from midnight local time onwards.
        const startOfDay = new Date()
        startOfDay.setHours(0, 0, 0, 0)
        const rows = await fetchFocusRows(startOfDay)

        // Last 7 days (today + 6 prior) for the weekly trend.
        const startOfWeek = new Date()
        startOfWeek.setHours(0, 0, 0, 0)
        startOfWeek.setDate(startOfWeek.getDate() - 6)
        const weekRows = await fetchFocusRows(startOfWeek)

        // Categories so we know which are productive.
        const cats = await fetchCategories()

        // Build a lookup: { "Deep Work": true, "Social Media": false, ... }
        const productiveMap = {}
        for (const c of cats) {
          productiveMap[c.name] = c.is_productive
        }

        // Filter out system/ambiguous (is_productive === null) for percentage math.
        const counted = rows.filter(r => productiveMap[r.category_name] !== null
                                      && productiveMap[r.category_name] !== undefined)
        const productiveCount = counted.filter(r => productiveMap[r.category_name] === true).length
        const unproductiveCount = counted.filter(r => productiveMap[r.category_name] === false).length

        const today = {
          totalEvents: rows.length,                // all events, including System
          totalMinutes: Math.round(rows.length / ROWS_PER_MINUTE),   // full screen time
          countedEvents: counted.length,           // events that influence the % calc
          productiveEvents: productiveCount,
          productivePct: counted.length === 0 ? 0 : Math.round(100 * productiveCount / counted.length),
          productiveMinutes: Math.round(productiveCount / ROWS_PER_MINUTE),
          unproductiveEvents: unproductiveCount,
          unproductiveMinutes: Math.round(unproductiveCount / ROWS_PER_MINUTE),
        }

        // --- Category breakdown for today ---
        // Tally events per category. Include System/Ambiguous so the chart shows everything.
        const tallies = {}
        for (const r of rows) {
          const name = r.category_name || 'Unknown'
          tallies[name] = (tallies[name] || 0) + 1
        }

        // Convert tally object into an array Recharts can consume.
        const byCategory = Object.entries(tallies)
          .map(([name, count]) => ({
            name,
            count,
            minutes: Math.round(count / ROWS_PER_MINUTE),
            isProductive: productiveMap[name] ?? null,  // true / false / null
          }))
          .sort((a, b) => b.count - a.count)  // largest first

        // --- Weekly: group rows by local date, compute productivity % per day ---
        // The monitor's timestamps are naive LOCAL "YYYY-MM-DD HH:MM:SS"
        // strings, so the local date is literally the first ten characters.
        // Round-tripping through Date/toISOString converts to UTC and shifts
        // every evening row (past 5pm at UTC-7) into the NEXT day's bucket —
        // which is how Friday night's work showed up as Saturday-morning
        // productivity before the user was even awake.
        const dailyTallies = {}
        for (const r of weekRows) {
          const key = String(r.timestamp || '').slice(0, 10)  // "YYYY-MM-DD"
          if (!dailyTallies[key]) {
            dailyTallies[key] = { total: 0, productive: 0, counted: 0 }
          }
          dailyTallies[key].total += 1
          const isProd = productiveMap[r.category_name]
          if (isProd === true || isProd === false) {
            dailyTallies[key].counted += 1
            if (isProd === true) dailyTallies[key].productive += 1
          }
        }

        // Build a complete 7-day array — fill in zero for missing days.
        // Same rule as above: keys must be LOCAL dates. toISOString here only
        // worked by luck at negative UTC offsets (local midnight is still the
        // same date in UTC); east of Greenwich it names the previous day.
        const localKey = (d) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const weekly = []
        for (let i = 6; i >= 0; i--) {
          const d = new Date()
          d.setHours(0, 0, 0, 0)
          d.setDate(d.getDate() - i)
          const key = localKey(d)
          const tally = dailyTallies[key] || { total: 0, productive: 0, counted: 0 }
          weekly.push({
            date: key,
            dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }),  // "Mon", "Tue"
            totalEvents: tally.total,
            productiveEvents: tally.productive,
            productiveMinutes: Math.round(tally.productive / ROWS_PER_MINUTE),
            productivePct: tally.counted === 0 ? 0 : Math.round(100 * tally.productive / tally.counted),
          })
        }

        if (!cancelled) {
          setData({ today, byCategory, weekly })
          setError(null)
          setLastUpdated(new Date())
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || String(e))
          setLoading(false)
        }
      }
    }

    fetchAll()
    const id = setInterval(fetchAll, pollMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [pollMs])

  return { data, error, loading, lastUpdated }
}
