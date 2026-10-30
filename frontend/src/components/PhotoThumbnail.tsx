import { useState } from 'react'
import { api } from '../api'
import type { PhotoInfo } from '../types'

interface Props {
  photo: PhotoInfo
  version: number
  className?: string
  /** load right away (for images that are always near the top of the page) */
  eager?: boolean
}

/** Lazy-loaded thumbnail that shows a soft placeholder while loading or if the image fails. */
export function PhotoThumbnail({ photo, version, className = '', eager = false }: Props) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  return (
    <span className={`pthumb ${state} ${className}`}>
      {state !== 'error' && (
        <img
          src={api.thumbUrl(photo.id, version)}
          alt={photo.name}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
        />
      )}
    </span>
  )
}
