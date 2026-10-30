import { api, isWeb, mb } from '../api'
import { describe } from '../decisions'
import type { Decision, PhotoInfo } from '../types'

interface Props {
  photo: PhotoInfo
  decision: Decision
  best: boolean
  version: number
  onChange: (d: Decision) => void
  onOpen: () => void
}

export function PhotoCard({ photo, decision, best, version, onChange, onOpen }: Props) {
  const d = decision
  const date = new Date(photo.date)
  return (
    <div className={`card ${d.delete ? 'is-delete' : 'is-keep'}`}>
      <button className="thumb" onClick={onOpen} title="Open large preview">
        <img
          loading="lazy"
          src={api.thumbUrl(photo.id, version)}
          alt={photo.name}
          style={{
            transform: `rotate(${d.rotate * 90}deg)`,
            // when turned sideways the box's width/height swap
            ...(d.rotate % 2 ? { maxWidth: 190, maxHeight: 'none' } : {}),
          }}
        />
      </button>
      <span className="badge">{d.delete ? 'DELETE' : 'KEEP'}</span>
      {best && <span className="star">★ best</span>}
      <div className="meta">
        <div className="name" title={photo.name}>
          {photo.name}
        </div>
        <div>
          {date.toLocaleString()} · {mb(photo.size)}
        </div>
        <div>
          {photo.width}×{photo.height} · sharpness {Math.round(photo.sharpness)}
          {photo.ai_quality !== null && (
            <span title="AI quality score (CLIP-IQA), 0-100" className="nowrap">
              {' '}
              · AI {Math.round(photo.ai_quality * 100)}
            </span>
          )}
        </div>
      </div>
      <div className="actions">
        <button className="toggle" onClick={() => onChange({ ...d, delete: !d.delete })}>
          {d.delete ? 'Keep' : 'Delete'}
        </button>
        <button title="Rotate left" onClick={() => onChange({ ...d, rotate: (d.rotate + 3) % 4 })}>
          ⟲
        </button>
        <button title="Rotate right" onClick={() => onChange({ ...d, rotate: (d.rotate + 1) % 4 })}>
          ⟳
        </button>
        <label className="check" hidden={isWeb}>
          <input
            type="checkbox"
            checked={d.shrink}
            disabled={d.delete}
            onChange={(e) => onChange({ ...d, shrink: e.target.checked })}
          />
          shrink
        </label>
      </div>
      <div className="changes">{describe(d).join(' · ')}</div>
    </div>
  )
}
