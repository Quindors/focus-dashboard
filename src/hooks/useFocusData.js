import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const ROWS_PER_MINUTE = 6  // decision_interval = 10s → 6 rows/min

export function useFocusData() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchAll() {
      // Fetch today's rows: from midnight local time onwards.
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)

      const { data: rows, error: fetchError } = await supabase
        .from('focus_logs')
        .select('timestamp, category_name, confidence')
        .gte('timestamp', startOfDay.toISOString())
        .order('timestamp', { ascending: false })

      if (fetchError) {
        setError(fetchError.message)
        setLoading(false)
        return
      }

      // --- Fetch last 7 days for weekly trend ---
      const startOfWeek = new Date()
      startOfWeek.setHours(0, 0, 0, 0)
      startOfWeek.setDate(startOfWeek.getDate() - 6)  // include today + 6 prior

      const { data: weekRows, error: weekError } = await supabase
        .from('focus_logs')
        .select('timestamp, category_name')
        .gte('timestamp', startOfWeek.toISOString())
        .order('timestamp', { ascending: true })

      if (weekError) {
        setError(weekError.message)
        setLoading(false)
        return
      }

      // Fetch categories so we know which are productive.
      const { data: cats, error: catsError } = await supabase
        .from('categories')
        .select('name, is_productive')

      if (catsError) {
        setError(catsError.message)
        setLoading(false)
        return
      }

      // Build a lookup: { "Deep Work": true, "Social Media": false, ... }
      const productiveMap = {}
      for (const c of cats) {
        productiveMap[c.name] = c.is_productive
      }

      // Filter out system/ambiguous (is_productive === null) for percentage math.
      const counted = rows.filter(r => productiveMap[r.category_name] !== null
                                    && productiveMap[r.category_name] !== undefined)
      const productiveCount = counted.filter(r => productiveMap[r.category_name] === true).length

      const today = {
        totalEvents: rows.length,                // all events, including System
        countedEvents: counted.length,           // events that influence the % calc
        productiveEvents: productiveCount,
        productivePct: counted.length === 0 ? 0 : Math.round(100 * productiveCount / counted.length),
        productiveMinutes: Math.round(productiveCount / ROWS_PER_MINUTE),
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
      const dailyTallies = {}
      for (const r of weekRows) {
        const localDate = new Date(r.timestamp)
        const key = localDate.toISOString().slice(0, 10)  // "YYYY-MM-DD"
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
      const weekly = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        const tally = dailyTallies[key] || { total: 0, productive: 0, counted: 0 }
        weekly.push({
          date: key,
          dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }),  // "Mon", "Tue"
          totalEvents: tally.total,
          productiveEvents: tally.productive,
          productivePct: tally.counted === 0 ? 0 : Math.round(100 * tally.productive / tally.counted),
        })
      }

      setData({ today, byCategory, weekly })
      setLoading(false)
    }

    fetchAll()
  }, [])

  return { data, error, loading }
}