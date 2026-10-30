import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { Decisions } from '../decisions'
import type { PhotoSet } from '../sets'
import { PhotoCategoryCard } from './PhotoCategoryCard'

const EAGER_CARDS = 8 // the first cards are always visible; the rest load as they scroll in

interface Props {
  /** small text next to the heading, e.g. "8 categories" */
  meta: string
  sets: PhotoSet[]
  decisions: Decisions
  version: number
  active: string | null
  onSelect: (key: string) => void
  /** shown instead of the cards, e.g. while AI mode is still sorting */
  placeholder?: ReactNode
}

/** "Sorting" animation: each card thumbnail flies in from where that photo lies in the pile.
 *  Runs when the sets change (folder opened, mode or strictness changed). */
function useFlyFromPile(grid: HTMLElement | null, signature: string) {
  useLayoutEffect(() => {
    if (!grid || !signature || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const cells = grid.querySelectorAll<HTMLElement>('.strip-cell[data-photo]')
    cells.forEach((cell, i) => {
      const id = cell.dataset.photo!
      const print = document.querySelector<HTMLElement>(`.print[data-photo="${CSS.escape(id)}"]`)
      const to = cell.getBoundingClientRect()
      if (!print || !to.width) return
      const from = print.getBoundingClientRect()
      if (from.bottom < 0 || from.top > innerHeight) return // heap off-screen (stacked layout)
      const dx = from.left + from.width / 2 - (to.left + to.width / 2)
      const dy = from.top + from.height / 2 - (to.top + to.height / 2)
      const tilt = print.style.getPropertyValue('--tilt') || '0deg'
      cell.animate(
        [
          {
            transform: `translate(${dx}px, ${dy}px) scale(${from.width / to.width}) rotate(${tilt})`,
          },
          { transform: 'none' },
        ],
        {
          duration: 820,
          delay: 150 + Math.min(i * 28, 1100),
          easing: 'cubic-bezier(.2,.75,.25,1)',
          fill: 'backwards',
        },
      )
    })
  }, [grid, signature])
}

export function PhotoCategorySection(props: Props) {
  const { meta, sets, decisions, version, active, onSelect, placeholder } = props
  const gridRef = useRef<HTMLDivElement>(null)
  const signature = placeholder ? '' : sets.map((s) => `${s.key}:${s.photos.length}`).join('|')
  useFlyFromPile(gridRef.current, signature)
  return (
    <section className="sets" aria-labelledby="sets-title">
      <div className="section-head">
        <h2 id="sets-title" className="serif-title dotted">
          Photos
        </h2>
        <span className="muted small">{meta}</span>
      </div>
      {placeholder ?? (
        <div className="setgrid" ref={gridRef}>
          {sets.map((s, i) => (
            <PhotoCategoryCard
              key={s.key}
              set={s}
              decisions={decisions}
              version={version}
              active={active === s.key}
              eager={i < EAGER_CARDS}
              onSelect={() => onSelect(s.key)}
            />
          ))}
          {!sets.length && <p className="muted small">No photos in this folder.</p>}
        </div>
      )}
    </section>
  )
}
