import { useEffect, useState } from 'react'
import { fetchFocusRows, fetchCategories } from '../lib/dataSource'

const ROWS_PER_MINUTE = 6  // decision_interval = 10s → 6 rows/min

// "Productive only while declared": a neutral category (is_productive null —
// Composition, say) counts as productive when the row was logged under a
// focus session and scored at least partially on-intent. 0.5 is the monitor's
// off-intent line (intention.off_intent_max), the same one that turns
// off-intent productive work into off-task for Beeminder. This mirrors
// monitor/beeminder.py (_DAY_QUERY / NEVER_DECLARED) — keep the two in step,
// or the pie and the datapoint stop agreeing. Ambiguous and System never
// qualify: they mean the monitor could not tell what the time was for, and a
// session does not change that.
const DECLARED_MIN_ALIGN = 0.5
const NEVER_DECLARED = new Set(['ambiguous', 'system'])
// Suffix on the pie's declared slices: "Composition (in session)".
export const IN_SESSION = ' (in session)'

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

        // Declared neutral work: a real, neutral category, logged under a
        // session, not off-intent. See the note at the top of the file.
        const declared = (r) =>
          Object.prototype.hasOwnProperty.call(productiveMap, r.category_name)
          && productiveMap[r.category_name] == null
          && !NEVER_DECLARED.has(String(r.category_name).toLowerCase())
          && r.intention_id != null
          && r.align_score != null && r.align_score >= DECLARED_MIN_ALIGN

        // What a row counts as: its category's flag, or true for declared
        // neutral work. null means it counts as neither.
        const countsAs = (r) => {
          const flag = productiveMap[r.category_name]
          if (flag === true || flag === false) return flag
          return declared(r) ? true : null
        }

        // Productive % is productive time over ALL logged time - System and
        // Ambiguous rows included in the denominator. Every row is a slice of
        // the day at the screen; time the monitor could not place is still
        // time that was not spent on productive work. `counted` (rows with a
        // definite productive/off-task verdict) is kept for the split itself.
        const counted = rows.filter(r => countsAs(r) !== null)
        const productiveCount = counted.filter(r => countsAs(r) === true).length
        const unproductiveCount = counted.filter(r => countsAs(r) === false).length

        const today = {
          totalEvents: rows.length,                // all events, including System
          totalMinutes: Math.round(rows.length / ROWS_PER_MINUTE),   // full screen time
          countedEvents: counted.length,           // events that influence the % calc
          productiveEvents: productiveCount,
          productivePct: rows.length === 0 ? 0 : Math.round(100 * productiveCount / rows.length),
          productiveMinutes: Math.round(productiveCount / ROWS_PER_MINUTE),
          unproductiveEvents: unproductiveCount,
          unproductiveMinutes: Math.round(unproductiveCount / ROWS_PER_MINUTE),
        }

        // --- Category breakdown for today ---
        // Tally events per category. Include System/Ambiguous so the chart
        // shows everything. Declared neutral work gets a slice of its own —
        // "Composition (in session)", green — beside the plain neutral slice,
        // so the pie shows both that the time counted and why.
        const tallies = {}
        for (const r of rows) {
          const category = r.category_name || 'Unknown'
          const inSession = declared(r)
          const key = inSession ? category + IN_SESSION : category
          if (!tallies[key]) tallies[key] = { category, inSession, count: 0 }
          tallies[key].count += 1
        }

        // Convert tally object into an array Recharts can consume.
        const byCategory = Object.entries(tallies)
          .map(([name, t]) => ({
            name,                      // slice label: the category, suffixed when declared
            category: t.category,      // the category itself
            inSession: t.inSession,    // declared session work, counted as productive
            count: t.count,
            minutes: Math.round(t.count / ROWS_PER_MINUTE),
            isProductive: t.inSession ? true : (productiveMap[t.category] ?? null),  // true / false / null
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
          const isProd = countsAs(r)
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
            productivePct: tally.total === 0 ? 0 : Math.round(100 * tally.productive / tally.total),
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
