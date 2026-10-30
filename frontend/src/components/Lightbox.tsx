import { useEffect } from 'react'
import { api } from '../api'
import type { Decision, PhotoInfo } from '../types'

const NONE: Decision = { delete: false, rotate: 0, shrink: false }

interface Props {
  photos: PhotoInfo[]
  index: number
  decisions: Record<string, Decision>
  version: number
  onIndex: (i: number | null) => void
  onChange: (id: string, d: Decision) => void
}

/** Large preview. Keys: ← → navigate · D toggle delete · R rotate · Esc close */
export function Lightbox({ photos, index, decisions, version, onIndex, onChange }: Props) {
  const photo = photos[index]
  const d = decisions[photo.id] ?? NONE

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onIndex(null)
      else if (e.key === 'ArrowRight') onIndex(Math.min(index + 1, photos.length - 1))
      else if (e.key === 'ArrowLeft') onIndex(Math.max(index - 1, 0))
      else if (e.key.toLowerCase() === 'd') onChange(photo.id, { ...d, delete: !d.delete })
      else if (e.key.toLowerCase() === 'r') onChange(photo.id, { ...d, rotate: (d.rotate + 1) % 4 })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, photos.length, photo.id, d, onIndex, onChange])

  return (
    <div className="lightbox" onClick={() => onIndex(null)}>
      <img
        src={api.previewUrl(photo.id, version)}
        alt={photo.name}
        style={{
          transform: `rotate(${d.rotate * 90}deg)`,
          ...(d.rotate % 2 ? { maxWidth: '80vh', maxHeight: '94vw' } : {}),
        }}
      />
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onIndex(Math.max(index - 1, 0))} disabled={index === 0}>
          ←
        </button>
        <span>
          {photo.name} · {index + 1}/{photos.length} ·{' '}
          <b className={d.delete ? 'red' : 'green'}>{d.delete ? 'DELETE' : 'KEEP'}</b>
        </span>
        <button onClick={() => onChange(photo.id, { ...d, delete: !d.delete })}>
          {d.delete ? 'Keep (D)' : 'Delete (D)'}
        </button>
        <button onClick={() => onChange(photo.id, { ...d, rotate: (d.rotate + 1) % 4 })}>
          Rotate (R)
        </button>
        <button
          onClick={() => onIndex(Math.min(index + 1, photos.length - 1))}
          disabled={index === photos.length - 1}
        >
          →
        </button>
        <button onClick={() => onIndex(null)}>Close (Esc)</button>
      </div>
    </div>
  )
}
