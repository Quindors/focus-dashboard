import { useEffect, useState } from 'react'

// Arrows over the edges of a forest scroller. They exist only while the
// pointer is near that edge and there is a forest on that side; a click
// moves one grove. The scroller's parent becomes the positioning box, and
// the arrows sit at the scroller's own vertical centre, so no wrapper is
// needed around the scroller.
const NEAR_PX = 90

export default function EdgeArrows({ scrollerRef }) {
  const [near, setNear] = useState(null)
  const [can, setCan] = useState({ left: false, right: false })
  const [top, setTop] = useState(0)

  useEffect(() => {
    const sc = scrollerRef.current
    if (!sc) return
    const host = sc.parentElement
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
    const update = () => {
      setCan({ left: sc.scrollLeft > 4, right: sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 4 })
      setTop(sc.offsetTop + sc.offsetHeight / 2)
    }
    const move = (e) => {
      const r = sc.getBoundingClientRect()
      const x = e.clientX - r.left
      const inside = e.clientY >= r.top && e.clientY <= r.bottom
      setNear(!inside ? null : x < NEAR_PX ? 'left' : x > r.width - NEAR_PX ? 'right' : null)
    }
    const leave = () => setNear(null)
    update()
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerleave', leave)
    sc.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerleave', leave)
      sc.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [scrollerRef])

  const go = (dir) => {
    const sc = scrollerRef.current
    if (!sc) return
    const grove = sc.querySelector('.ff-grove')
    const step = grove ? grove.offsetWidth + 20 : sc.clientWidth * 0.9
    sc.scrollBy({ left: dir * step, behavior: 'smooth' })
  }

  const arrow = (dir, label, show) => (
    <button
      type="button"
      aria-label={label}
      onClick={() => go(dir)}
      style={{ top }}
      className={`absolute -translate-y-1/2 ${dir < 0 ? 'left-3' : 'right-3'} z-10 w-10 h-10 rounded-full
        bg-white/90 dark:bg-slate-900/90 text-slate-700 dark:text-slate-200 shadow-md
        border border-slate-200 dark:border-slate-700 flex items-center justify-center
        transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {dir < 0 ? <path d="M12.5 4 L7 10 L12.5 16" /> : <path d="M7.5 4 L13 10 L7.5 16" />}
      </svg>
    </button>
  )

  return (
    <>
      {arrow(-1, 'Previous forest', near === 'left' && can.left)}
      {arrow(1, 'Next forest', near === 'right' && can.right)}
    </>
  )
}
