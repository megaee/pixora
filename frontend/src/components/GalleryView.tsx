import { useState } from 'react'
import type { PhotoSet } from '../sets'
import type { CategoryInfo, PhotoInfo } from '../types'
import { PhotoThumbnail } from './PhotoThumbnail'

interface Props {
  set: PhotoSet
  kind: 'set' | 'category'
  categories: CategoryInfo[] | null
  labels: Record<string, string>
  /** for a category: photos listed only as an extra label */
  secondary?: Set<string>
  version: number
  /** other similar sets this one can be merged into */
  mergeTargets: PhotoSet[]
  onBack: () => void
  onOpenPhoto: (id: string) => void
  onCategory: (id: string, category: string | null) => void
  onExclude: (id: string) => void
  onSplit: (selected: string[]) => void
  onMerge: (targetKey: string) => void
  onReview: () => void
}

const pct = (v: number) => `${Math.round(v * 100)}%`

function photoInfo(p: PhotoInfo, labels: Record<string, string>, secondary: boolean) {
  if (!p.category) return 'not classified yet'
  if (p.overridden) return `${labels[p.category]} · set by you`
  if (secondary) {
    const label = p.labels.find((l) => l.id !== p.category)
    return `mainly ${labels[p.category]}${label ? ` · ${pct(label.score)} here` : ''}`
  }
  if (p.category === 'other') return 'no confident category'
  return `${labels[p.category]} · ${pct(p.confidence ?? 0)} sure`
}

/** All photos of one set or category, with corrections: change category, remove from set,
 *  split selected photos into a new set, merge with another set. Every change is saved. */
export function GalleryView(props: Props) {
  const { set, kind, categories, labels, secondary, version, mergeTargets } = props
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const canSplit = kind === 'set' && selected.size > 0 && selected.size < set.photos.length
  return (
    <section className="gallery" aria-labelledby="gallery-title">
      <button className="link back" onClick={props.onBack}>
        ← All photos
      </button>
      <div className="section-head">
        <h2 id="gallery-title" className="serif-title">
          {set.title}
        </h2>
        <span className="muted small">
          {set.photos.length} photos · {kind === 'set' ? 'similar set' : 'category'} ·{' '}
          {set.subtitle}
          {set.cohesion && ` · least alike pair ${pct(set.cohesion.value)}`}
        </span>
      </div>
      {kind === 'set' && (
        <div className="setbar">
          <button disabled={!canSplit} onClick={() => props.onSplit([...selected])}>
            Split {selected.size || ''} selected into a new set
          </button>
          <select
            value=""
            aria-label="Merge with another set"
            disabled={!mergeTargets.length}
            onChange={(e) => e.target.value && props.onMerge(e.target.value)}
          >
            <option value="">Merge with…</option>
            {mergeTargets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.title} · {t.subtitle} ({t.photos.length})
              </option>
            ))}
          </select>
          <span className="spacer" />
          <button className="primary" onClick={props.onReview}>
            Review this set
          </button>
        </div>
      )}
      <div className="ggrid">
        {set.photos.map((p) => (
          <div key={p.id} className={`gtile${selected.has(p.id) ? ' selected' : ''}`}>
            <button className="gthumb" onClick={() => props.onOpenPhoto(p.id)} title="Open preview">
              <PhotoThumbnail photo={p} version={version} />
            </button>
            {kind === 'set' && (
              <label className="gcheck">
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  aria-label={`Select ${p.name}`}
                />
              </label>
            )}
            <div className="gmeta">
              <div className="name" title={p.name}>
                {p.name}
                {set.best === p.id && <span className="gbest"> ★</span>}
              </div>
              <div className="muted small">{photoInfo(p, labels, !!secondary?.has(p.id))}</div>
            </div>
            <div className="gactions">
              <select
                value={p.overridden ? (p.category ?? '') : ''}
                aria-label={`Category of ${p.name}`}
                disabled={!categories && !p.overridden}
                onChange={(e) => props.onCategory(p.id, e.target.value || null)}
              >
                <option value="">
                  {p.overridden
                    ? 'Back to automatic'
                    : `Auto${p.category ? `: ${labels[p.category]}` : ''}`}
                </option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              {kind === 'set' && (
                <button className="link small" onClick={() => props.onExclude(p.id)}>
                  Remove from set
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
