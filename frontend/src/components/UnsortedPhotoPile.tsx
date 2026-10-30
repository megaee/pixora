import { useMemo, useState } from 'react'
import { layoutPile } from '../pile'
import type { PhotoInfo } from '../types'
import { ShuffleIcon } from './icons'
import { PhotoThumbnail } from './PhotoThumbnail'

const TRAY = 10

interface Props {
  photos: PhotoInfo[]
  version: number
  onOpen: (id: string) => void
}

/** The folder as it is: a round heap of real thumbnails spilling out of a folder tray.
 *  Purely visual and safe: clicking a print opens the preview, "shuffle" re-deals the heap. */
export function UnsortedPhotoPile({ photos, version, onOpen }: Props) {
  const [shuffle, setShuffle] = useState(0)
  const items = useMemo(() => layoutPile(photos, shuffle), [photos, shuffle])
  const tray = useMemo(
    () => [...photos].sort((a, b) => a.date.localeCompare(b.date)).slice(0, TRAY),
    [photos],
  )
  return (
    <figure className="pile-wrap" aria-label="All photos in this folder">
      <div className="pile">
        <div className="tray" aria-hidden="true">
          {tray.map((p) => (
            <span key={p.id} className="tray-cell">
              <PhotoThumbnail photo={p} version={version} eager />
            </span>
          ))}
        </div>
        {items.map((it) => (
          <button
            key={it.photo.id}
            className="print"
            data-photo={it.photo.id}
            title={it.photo.name}
            aria-label={`Preview ${it.photo.name}`}
            onClick={() => onOpen(it.photo.id)}
            style={{
              left: `${it.left}%`,
              top: `${it.top}%`,
              width: `${it.size}%`,
              zIndex: it.z,
              ['--tilt' as string]: `${it.rotate.toFixed(1)}deg`,
            }}
          >
            <PhotoThumbnail photo={it.photo} version={version} eager />
          </button>
        ))}
      </div>
      <figcaption>
        <span className="serif-caption">a total mess</span>
        <span className="muted small">
          {photos.length} photos{photos.length > items.length ? `, ${items.length} shown` : ''}
        </span>
        <button className="link small" onClick={() => setShuffle((s) => s + 1)}>
          <ShuffleIcon /> shuffle
        </button>
      </figcaption>
    </figure>
  )
}
