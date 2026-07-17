import { useCallback, useEffect, useState } from 'react'
import { fetchCategories, addCategory, updateCategory } from '../lib/dataSource'

const PRODUCTIVITY = [
  { value: 'productive', label: 'Productive', is_productive: true },
  { value: 'offtask', label: 'Off-task', is_productive: false },
  { value: 'neutral', label: 'Neutral', is_productive: null },
]

function toValue(isProductive) {
  return isProductive === true ? 'productive' : isProductive === false ? 'offtask' : 'neutral'
}

function toFlag(value) {
  return PRODUCTIVITY.find((p) => p.value === value)?.is_productive ?? null
}

const inputClass =
  'w-full text-sm rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 ' +
  'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ' +
  'placeholder:text-slate-300 dark:placeholder:text-slate-600 transition-colors'

function ProductivitySelect({ value, onChange, disabled }) {
  const tone =
    value === 'productive'
      ? 'text-emerald-600 dark:text-emerald-400'
      : value === 'offtask'
        ? 'text-red-500 dark:text-red-400'
        : 'text-slate-500 dark:text-slate-400'
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`text-sm rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 bg-white dark:bg-slate-800 ${tone} disabled:opacity-50 transition-colors`}
    >
      {PRODUCTIVITY.map((p) => (
        <option key={p.value} value={p.value}>{p.label}</option>
      ))}
    </select>
  )
}

// One editable category row. Save enables once something changed.
function CategoryRow({ cat, onSave, busy }) {
  const [name, setName] = useState(cat.name)
  const [description, setDescription] = useState(cat.description || '')
  const [productivity, setProductivity] = useState(toValue(cat.is_productive))

  // Re-sync if a reload brings fresh values (e.g. after a rename).
  useEffect(() => {
    setName(cat.name)
    setDescription(cat.description || '')
    setProductivity(toValue(cat.is_productive))
  }, [cat.name, cat.description, cat.is_productive])

  const dirty =
    name.trim() !== cat.name ||
    description.trim() !== (cat.description || '') ||
    productivity !== toValue(cat.is_productive)

  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 last:border-0">
      <td className="py-2 pr-3 align-top w-48">
        <input value={name} disabled={busy} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </td>
      <td className="py-2 pr-3 align-top">
        <input
          value={description}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What belongs here? (guides the AI)"
          className={inputClass}
        />
      </td>
      <td className="py-2 pr-3 align-top w-32">
        <ProductivitySelect value={productivity} onChange={setProductivity} disabled={busy} />
      </td>
      <td className="py-2 align-top w-20">
        <button
          onClick={() =>
            onSave(cat.name, {
              newName: name.trim(),
              description: description.trim(),
              is_productive: toFlag(productivity),
            })
          }
          disabled={busy || !dirty || !name.trim()}
          className="text-xs px-2.5 py-1.5 rounded-md bg-emerald-500 text-white font-medium hover:bg-emerald-600 disabled:opacity-30 disabled:hover:bg-emerald-500 transition-colors"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </td>
    </tr>
  )
}

function AddCategoryForm({ onAdd, busy }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [productivity, setProductivity] = useState('productive')

  async function submit() {
    const ok = await onAdd({
      name: name.trim(),
      description: description.trim(),
      is_productive: toFlag(productivity),
    })
    if (ok) {
      setName('')
      setDescription('')
      setProductivity('productive')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-5 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60">
      <input
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        placeholder="New category name"
        className={`${inputClass} !w-44`}
      />
      <input
        value={description}
        disabled={busy}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description — what belongs here? (guides the AI)"
        className={`${inputClass} flex-1 min-w-52`}
      />
      <ProductivitySelect value={productivity} onChange={setProductivity} disabled={busy} />
      <button
        onClick={submit}
        disabled={busy || !name.trim()}
        className="text-xs px-3 py-1.5 rounded-md bg-emerald-500 text-white font-medium hover:bg-emerald-600 disabled:opacity-30 disabled:hover:bg-emerald-500 transition-colors"
      >
        {busy ? 'Adding…' : 'Add category'}
      </button>
    </div>
  )
}

export default function CategoriesPanel() {
  const [categories, setCategories] = useState(null)
  const [error, setError] = useState(null)
  const [busyName, setBusyName] = useState(null) // category being saved, or '' for the add form

  const load = useCallback(async () => {
    try {
      setCategories(await fetchCategories())
      setError(null)
    } catch (e) {
      setError(e.message || String(e))
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAdd(fields) {
    setBusyName('')
    try {
      await addCategory(fields)
      await load()
      setError(null)
      return true
    } catch (e) {
      setError(`Could not add category: ${e.message || e}`)
      return false
    } finally {
      setBusyName(null)
    }
  }

  async function handleSave(name, fields) {
    setBusyName(name)
    try {
      await updateCategory(name, fields)
      await load()
      setError(null)
    } catch (e) {
      setError(`Could not save category: ${e.message || e}`)
    } finally {
      setBusyName(null)
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-transparent dark:border-slate-800 p-6 rounded-lg shadow-md transition-colors">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
        Categories
      </h2>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
        The AI classifies your activity into these categories — the description tells it what
        belongs where. Renaming a category also updates your logged history. Changes reach the
        monitor the next time it starts.
      </p>

      <AddCategoryForm onAdd={handleAdd} busy={busyName === ''} />

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
      {categories === null && !error && <p className="text-slate-500 dark:text-slate-400 text-sm">Loading…</p>}

      {categories && categories.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <th className="pb-2 pr-3 font-medium">Name</th>
                <th className="pb-2 pr-3 font-medium">Description</th>
                <th className="pb-2 pr-3 font-medium">Type</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <CategoryRow key={c.name} cat={c} onSave={handleSave} busy={busyName === c.name} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
