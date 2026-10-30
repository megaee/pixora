import type { Decisions } from '../decisions'
import type { Decision, PhotoInfo } from '../types'
import { PhotoCard } from './PhotoCard'

interface Props {
  title: string
  subtitle: string
  photos: PhotoInfo[]
  best: string | null
  decisions: Decisions
  version: number
  onChange: (id: string, d: Decision) => void
  onBulk: (patch: Decisions) => void
  onOpen: (id: string) => void
}

export function GroupSection(props: Props) {
  const { title, subtitle, photos, best, decisions, version, onChange, onBulk, onOpen } = props

  const keepAll = () =>
    onBulk(Object.fromEntries(photos.map((p) => [p.id, { ...decisions[p.id], delete: false }])))

  const kept = photos.filter((p) => !decisions[p.id]?.delete)
  const allShrunk = kept.length > 0 && kept.every((p) => decisions[p.id]?.shrink)
  const toggleShrink = () =>
    onBulk(Object.fromEntries(kept.map((p) => [p.id, { ...decisions[p.id], shrink: !allShrunk }])))

  return (
    <section className="group">
      <header className="group-head">
        <h2>{title}</h2>
        <span className="muted">{subtitle}</span>
        <span className="spacer" />
        <button onClick={keepAll}>Keep all</button>
        <button onClick={toggleShrink} disabled={!kept.length}>
          {allShrunk ? 'Un-shrink kept' : 'Shrink all kept'}
        </button>
      </header>
      <div className="grid">
        {photos.map((p) => (
          <PhotoCard
            key={p.id}
            photo={p}
            decision={decisions[p.id] ?? { delete: false, rotate: 0, shrink: false }}
            best={best === p.id}
            version={version}
            onChange={(d) => onChange(p.id, d)}
            onOpen={() => onOpen(p.id)}
          />
        ))}
      </div>
    </section>
  )
}
