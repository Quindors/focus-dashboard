// One error, shown the way the monitor writes them: what went wrong on the
// first line, what to do about it underneath in a quieter voice.
//
// The monitor answers every rejection with {error, fix} (monitor/problems.py)
// and dataSource puts both on the thrown Error, so the only thing a panel has
// to do is keep the error object instead of reaching for `.message`. This
// component takes whatever it is given — an Error, a {message, fix} status
// payload, or a bare string — so no caller has to normalise first.
//
// Splitting the two lines is the whole point. Run together, the fix reads as
// more error; set apart, it reads as the way out.
function problemOf(error) {
  if (!error) return null
  if (typeof error === 'string') return { message: error, fix: '' }
  return {
    message: error.message || String(error),
    fix: error.fix || '',
  }
}

export default function ErrorNote({ error, className = '', inline = false }) {
  const problem = problemOf(error)
  if (!problem) return null

  // Inline: sits in a row of buttons, so it must not force a line break of
  // its own. The fix still gets its own line, just a tighter one.
  if (inline) {
    return (
      <span className={`text-xs text-red-600 dark:text-red-400 ${className}`} role="alert">
        {problem.message}
        {problem.fix && (
          <span className="block text-slate-500 dark:text-slate-400 mt-0.5 max-w-prose">
            {problem.fix}
          </span>
        )}
      </span>
    )
  }

  return (
    <div className={`text-sm ${className}`} role="alert">
      <p className="text-red-600 dark:text-red-400">{problem.message}</p>
      {problem.fix && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-prose">
          {problem.fix}
        </p>
      )}
    </div>
  )
}
