import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext({ isDark: false, toggle: () => {} })

const prefersDark = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-color-scheme: dark)').matches

export function ThemeProvider({ children }) {
  // choice: 'system' follows the browser live; 'light'/'dark' is a manual override.
  const [choice, setChoice] = useState(() => {
    const saved = localStorage.getItem('theme')
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  })
  const [systemDark, setSystemDark] = useState(prefersDark)

  // Track the browser theme so 'system' conforms live (until the user overrides).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const isDark = choice === 'system' ? systemDark : choice === 'dark'

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // The button sets an explicit override to the opposite of what's showing.
  const toggle = () => {
    const next = isDark ? 'light' : 'dark'
    setChoice(next)
    localStorage.setItem('theme', next)
  }

  return (
    <ThemeContext.Provider value={{ isDark, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
