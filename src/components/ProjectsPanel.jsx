import { useCallback, useEffect, useMemo, useState } from 'react'
// (useEffect is still used by the panel itself for its loads.)
import ErrorNote from './ErrorNote'
import {
  addProject,
  deleteProject,
  fetchCategories,
  fetchProjects,
  fetchSessions,
  fetchStocks,
  pickableCategory,
  setProjectTicker,
  updateProject,
} from '../lib/dataSource'

// Projects are the long-lived thing a focus session is part of. A session is
// one sitting; a project is what the sittings add up to. A project may name
// a home category: starting a session inside it then counts as picking that
// category by hand — the gate double-checks it, and a hedged ALIGN inside
// that category reads as on-intent. Without one, the gate decides as usual.
// The intention itself never changes: ALIGN is still scored against the
// declared text, project or not.

const inputClass =
  'w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 ' +
  'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ' +
  'placeholder:text-slate-300 dark:placeholder:text-slate-600 transition-colors'

const NO_CATEGORY = ''

function CategorySelect({ value, onChange, cats, disabled }) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Home category"
      className="text-sm rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-50 transition-colors"
    >
      <option value={NO_CATEGORY}>Let the gate decide</option>
      {cats.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
    </select>
  )
}

const parseTs = (s) => new Date(String(s).replace(' ', 'T'))
function fmtHours(mins) {
  if (!mins) return '0 h'
  const h = mins / 60
  return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`
}
const fmtDate = (s) =>
  parseTs(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// A project can hold a stock: every productive hour worked in its sessions
// buys a fixed dollar amount of one ticker in a PAPER account — pretend
// money, real prices (monitor/stocks.py). It is a score that only grows by
// working, so a gain is shown in green and a loss in the same quiet grey as
// everything else: the market's bad day is not the user's.
const fmtUsd = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`)
const fmtShares = (n) => Number(n).toFixed(n >= 1 ? 3 : 4)
function Gain({ usd, pct }) {
  if (usd == null) return null
  const up = usd >= 0
  return (
    <span className={up ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}>
      {up ? '+' : '−'}${Math.abs(usd).toFixed(2)}
      {pct != null && ` (${up ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)`}
    </span>
  )
}

function marketNote(market) {
  if (!market) return null
  return market.is_open ? 'Market open' : 'Market closed — buys queue for the next open'
}

// The whole paper portfolio in one line, above the table.
function PortfolioStrip({ stocks }) {
  if (!stocks || (!stocks.configured && !stocks.keys)) return null
  const t = stocks.totals || {}
  const anyTicker = (stocks.projects || []).some((p) => p.symbol || p.shares > 0 || p.queued_usd > 0)
  return (
    <div className="mb-5 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60" data-testid="portfolio">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Paper portfolio
        </span>
        {stocks.configured && anyTicker && (
          <span className="text-sm text-slate-700 dark:text-slate-200 tabular-nums">
            <span className="font-semibold">{fmtUsd(t.value_usd)}</span>
            <span className="text-slate-400 dark:text-slate-500"> from {fmtUsd(t.invested_usd)} of focused hours </span>
            <Gain usd={t.gain_usd} pct={t.invested_usd > 0 && t.gain_usd != null ? (100 * t.gain_usd) / t.invested_usd : null} />
          </span>
        )}
        {stocks.configured && (
          <span className="text-xs text-slate-400 dark:text-slate-500">{marketNote(stocks.market)}</span>
        )}
      </div>
      {stocks.configured && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
          {anyTicker
            ? `Each productive hour in a project's sessions buys $${stocks.usd_per_hour} of its stock, in pretend money at real prices (15 minutes delayed).`
            : `Give a project a ticker below and each productive hour in its sessions buys $${stocks.usd_per_hour} of that stock — pretend money, real prices.`}
        </p>
      )}
      {stocks.problem && (
        <ErrorNote error={{ message: stocks.problem.error, fix: stocks.problem.fix }} className="mt-2" />
      )}
    </div>
  )
}

// A project's ticker and what its hours have bought, on one line under the
// description. The ticker saves on its own button, apart from the row's
// Save: it is checked with the broker first.
function StockLine({ project, stock, minBuy, onTicker }) {
  const current = stock?.symbol || ''
  const [ticker, setTicker] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const typed = ticker.trim().toUpperCase()
  const changed = typed !== current

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await onTicker(project, typed)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const holds = stock && (stock.shares > 0 || (stock.holdings || []).length > 0)
  const quiet = 'text-slate-400 dark:text-slate-500'
  return (
    <div className="mt-1.5 text-xs" data-testid="stock">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`uppercase tracking-wide ${quiet}`}>Stock</span>
        <input
          value={ticker}
          disabled={busy}
          onChange={(e) => setTicker(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && changed) save() }}
          placeholder="Ticker"
          aria-label={`Stock ticker for ${project.name}`}
          maxLength={10}
          className={`${inputClass} !w-20 !text-xs uppercase placeholder:normal-case`}
        />
        {changed && (
          <button
            onClick={save}
            disabled={busy}
            className="px-2 py-1 rounded-md bg-emerald-500 text-white font-medium hover:bg-emerald-600 disabled:opacity-30 transition-colors"
          >
            {busy ? 'Checking…' : !typed ? 'Remove' : current ? 'Change' : 'Set'}
          </button>
        )}
        {stock?.asset_name && (
          <span className={`${quiet} truncate max-w-48`} title={stock.asset_name}>{stock.asset_name}</span>
        )}
        {holds && (
          <span className="text-slate-600 dark:text-slate-300 tabular-nums" data-testid="holding">
            {(stock.holdings || []).map((h) => `${fmtShares(h.shares)} ${h.symbol}`).join(' + ')}
            {' · '}{fmtUsd(stock.value_usd)}{' '}
            <Gain usd={stock.gain_usd} pct={stock.gain_pct} />
          </span>
        )}
        {stock?.queued_usd > 0 && (
          <span className={`${quiet} tabular-nums`}>{fmtUsd(stock.queued_usd)} queued for the open</span>
        )}
        {stock?.symbol && stock.owed_usd > 0 && !stock.problem && (
          <span className={`${quiet} tabular-nums`}>{fmtUsd(stock.owed_usd)} earned, buys at {fmtUsd(minBuy)}</span>
        )}
        {stock?.symbol && !holds && !(stock.queued_usd > 0) && !(stock.owed_usd > 0) && (
          <span className={quiet}>Buys with your next productive session here</span>
        )}
      </div>
      {stock?.problem && (
        <ErrorNote inline error={{ message: stock.problem.error, fix: stock.problem.fix }} className="block mt-1" />
      )}
      <ErrorNote inline error={error} className="block mt-1" />
    </div>
  )
}

// One editable project row. Save enables once something changed.
function ProjectRow({ project, stats, cats, onSave, onArchive, onDelete, busy, stocksOn, stock, minBuy, onTicker }) {
  const [confirming, setConfirming] = useState(false)
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description || '')
  const [category, setCategory] = useState(project.category || NO_CATEGORY)
  // Fresh values after a save arrive through the row's key (see the table
  // below), which remounts it — no effect needed to re-sync the fields.

  const dirty =
    name.trim() !== project.name ||
    description.trim() !== (project.description || '') ||
    category !== (project.category || NO_CATEGORY)
  const archived = project.status === 'archived'

  return (
    <tr className={`border-b border-slate-100 dark:border-slate-800 last:border-0 ${archived ? 'opacity-70' : ''}`}>
      <td className="py-2 pr-3 align-top w-44">
        <input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} className={inputClass} maxLength={60} />
      </td>
      <td className="py-2 pr-3 align-top">
        <input
          value={description}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is the work? (context for the AI)"
          className={inputClass}
          maxLength={500}
        />
        {stocksOn && <StockLine project={project} stock={stock} minBuy={minBuy} onTicker={onTicker} />}
      </td>
      <td className="py-2 pr-3 align-top w-40">
        <CategorySelect value={category} onChange={setCategory} cats={cats} disabled={busy} />
      </td>
      <td className="py-2 pr-3 align-top w-36 text-xs text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
        {stats.count
          ? <>{stats.count} session{stats.count === 1 ? '' : 's'} · {fmtHours(stats.minutes)}<br /><span className="text-slate-400 dark:text-slate-500">last {fmtDate(stats.last)}</span></>
          : <span className="text-slate-400 dark:text-slate-500">no sessions yet</span>}
      </td>
      <td className="py-2 align-top w-52">
        {confirming ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500 dark:text-slate-400">Delete?</span>
            <button
              onClick={() => { setConfirming(false); onDelete(project) }}
              disabled={busy}
              title="Its sessions stay in the forest, with no project"
              className="text-xs px-2 py-1.5 rounded-md bg-red-500 text-white font-medium hover:bg-red-600 disabled:opacity-30 transition-colors"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="text-xs px-2 py-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onSave(project, { name: name.trim(), description: description.trim(), category: category || null })}
              disabled={busy || !dirty || !name.trim()}
              className="text-xs px-2.5 py-1.5 rounded-md bg-emerald-500 text-white font-medium hover:bg-emerald-600 disabled:opacity-30 disabled:hover:bg-emerald-500 transition-colors"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => onArchive(project, !archived)}
              disabled={busy}
              title={archived ? 'Show it in the session picker again' : 'Hide it from the session picker; its trees stay'}
              className="text-xs px-2 py-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
            >
              {archived ? 'Restore' : 'Archive'}
            </button>
            <button
              onClick={() => setConfirming(true)}
              disabled={busy}
              aria-label={`Delete ${project.name}`}
              className="text-xs px-2 py-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-30 transition-colors"
            >
              Delete
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

function AddProjectForm({ onAdd, cats, busy }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(NO_CATEGORY)

  async function submit() {
    const ok = await onAdd({ name: name.trim(), description: description.trim(), category: category || null })
    if (ok) {
      setName('')
      setDescription('')
      setCategory(NO_CATEGORY)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-5 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
      <input
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) submit() }}
        placeholder="New project name"
        maxLength={60}
        className={`${inputClass} !w-44`}
      />
      <input
        value={description}
        disabled={busy}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) submit() }}
        placeholder="What is the work? — a sentence for the AI, e.g. “Stats 101 problem sets in Overleaf”"
        maxLength={500}
        className={`${inputClass} flex-1 min-w-52`}
      />
      <CategorySelect value={category} onChange={setCategory} cats={cats} disabled={busy} />
      <button
        onClick={submit}
        disabled={busy || !name.trim()}
        className="text-xs px-3 py-1.5 rounded-md bg-emerald-500 text-white font-medium hover:bg-emerald-600 disabled:opacity-30 disabled:hover:bg-emerald-500 transition-colors"
      >
        {busy ? 'Adding…' : 'Add project'}
      </button>
    </div>
  )
}

export default function ProjectsPanel() {
  const [projects, setProjects] = useState(null)
  const [sessions, setSessions] = useState([])
  const [cats, setCats] = useState([])
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busyId, setBusyId] = useState(null) // project being saved, or 'new' for the add form
  const [showArchived, setShowArchived] = useState(false)
  const [stocks, setStocks] = useState(null) // null: monitor off, or one from before stocks

  const load = useCallback(async () => {
    try {
      const [p, s, st] = await Promise.all([
        fetchProjects(true), fetchSessions().catch(() => []), fetchStocks(),
      ])
      setProjects(p)
      setSessions(s)
      setStocks(st)
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [])

  useEffect(() => { load() }, [load])
  // Prices move and buys land without anyone touching the page.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) fetchStocks().then(setStocks)
    }, 30000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    fetchCategories()
      .then((c) => setCats(c.filter(pickableCategory)))
      .catch(() => {})
  }, [])

  // Sessions are the truth about a project's size, on either data source:
  // the same finished set the forest plants, counted here per project.
  const statsById = useMemo(() => {
    const out = new Map()
    for (const s of sessions) {
      if (s.project_id == null || !s.started_at || !s.ended_at) continue
      const mins = Math.max(0, Math.round((parseTs(s.ended_at) - parseTs(s.started_at)) / 60000))
      const cur = out.get(s.project_id) || { count: 0, minutes: 0, last: null }
      cur.count += 1
      cur.minutes += mins
      if (!cur.last || s.started_at > cur.last) cur.last = s.started_at
      out.set(s.project_id, cur)
    }
    return out
  }, [sessions])
  const NONE = { count: 0, minutes: 0, last: null }

  const run = async (id, fn) => {
    setBusyId(id)
    setNotice(null)
    try {
      const r = await fn()
      await load()
      setError(null)
      return r ?? true
    } catch (e) {
      setError(e)
      return false
    } finally {
      setBusyId(null)
    }
  }

  const handleAdd = (fields) => run('new', () => addProject(fields))
  const handleSave = (p, fields) => run(p.id, () => updateProject(p.id, fields))
  const handleArchive = (p, archived) => run(p.id, () => updateProject(p.id, { archived }))
  const handleDelete = (p) => run(p.id, async () => {
    const r = await deleteProject(p.id)
    const n = r?.unlinked_sessions || 0
    setNotice(n
      ? `Deleted “${p.name}” — its ${n} session${n === 1 ? '' : 's'} stay in the forest, unfiled.`
      : `Deleted “${p.name}”.`)
    return r
  })

  // Not through run(): a refused ticker belongs next to the box it was typed
  // in, so the cell keeps the error and only a success reloads the tab.
  const handleTicker = async (p, symbol) => {
    await setProjectTicker(p.id, symbol)
    setStocks(await fetchStocks())
  }
  const stocksOn = !!stocks?.configured
  const stockById = useMemo(
    () => new Map((stocks?.projects || []).map((s) => [s.project_id, s])),
    [stocks],
  )

  const active = (projects || []).filter((p) => p.status !== 'archived')
  const archived = (projects || []).filter((p) => p.status === 'archived')

  const table = (rows) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-700">
            <th className="pb-2 pr-3 font-medium">Name</th>
            <th className="pb-2 pr-3 font-medium">Description</th>
            <th className="pb-2 pr-3 font-medium">Home category</th>
            <th className="pb-2 pr-3 font-medium">In the forest</th>
            <th className="pb-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <ProjectRow
              key={`${p.id}:${p.name}:${p.description || ''}:${p.category || ''}:${p.status}:${stockById.get(p.id)?.symbol || ''}`}
              project={p}
              stats={statsById.get(p.id) || NONE}
              cats={cats}
              onSave={handleSave}
              onArchive={handleArchive}
              onDelete={handleDelete}
              busy={busyId === p.id}
              stocksOn={stocksOn}
              stock={stockById.get(p.id)}
              minBuy={stocks?.min_buy_usd}
              onTicker={handleTicker}
            />
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
        Projects
      </h2>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
        A project is what your focus sessions add up to. Pick one when you start a session and
        the forest can show that project's trees on their own. A home category counts as picking
        that category for every session in the project — the gate still checks it — and the
        description gives the AI context for what screens about this project look like. The
        intention you declare is still what each session is scored against.
      </p>

      <AddProjectForm onAdd={handleAdd} cats={cats} busy={busyId === 'new'} />

      <PortfolioStrip stocks={stocks} />
      <ErrorNote error={error} className="mb-3" />
      {notice && <p className="text-sm text-emerald-600 dark:text-emerald-400 mb-3">{notice}</p>}
      {projects === null && !error && <p className="text-slate-500 dark:text-slate-400 text-sm">Loading…</p>}
      {projects && !projects.length && (
        <p className="text-slate-500 dark:text-slate-400 text-sm">
          No projects yet. Add one above — sessions you have already finished can be filed under it
          from the Forest tab by clicking their trees.
        </p>
      )}

      {active.length > 0 && table(active)}

      {archived.length > 0 && (
        <div className="mt-5">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
          >
            {showArchived ? '▾' : '▸'} Archived ({archived.length})
          </button>
          {showArchived && <div className="mt-3">{table(archived)}</div>}
        </div>
      )}
    </div>
  )
}
