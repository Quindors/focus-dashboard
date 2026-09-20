import { useEffect, useRef } from 'react'
import { drawTree, el, foliageFill } from '../lib/forestDraw'

// A single still tree for legends: the forest's own drawing, no scene.
export default function Mini({ kind, align = 0.88, sc, w, h }) {
  const ref = useRef(null)
  useEffect(() => {
    const s = ref.current
    s.replaceChildren()
    const g = drawTree(kind, foliageFill(kind, align), sc, null)
    g.classList.add('in'); g.style.transition = 'none'
    g.querySelector('.ff-sway').style.animation = 'none'
    const wrap = el('g', { transform: 'translate(0,-2)' }, s)
    wrap.appendChild(g)
  }, [kind, align, sc])
  return <svg ref={ref} viewBox={`${-w / 2} ${-h} ${w} ${h}`} width={w} height={h} aria-hidden="true" style={{ display: 'block' }} />
}
