import { createContext, useContext, useEffect, useRef, useState } from 'react'

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

  // Fade between themes: the transient .theme-fade class turns on color
  // transitions only around a flip, so hovers keep their own timing and the
  // initial paint doesn't animate.
  const hasMounted = useRef(false)
  useEffect(() => {
    const root = document.documentElement
    if (!hasMounted.current) {
      hasMounted.current = true
      root.classList.toggle('dark', isDark)
      return
    }
    root.classList.add('theme-fade')
    root.classList.toggle('dark', isDark)
    const t = setTimeout(() => root.classList.remove('theme-fade'), 400)
    return () => {
      clearTimeout(t)
      root.classList.remove('theme-fade')
    }
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
