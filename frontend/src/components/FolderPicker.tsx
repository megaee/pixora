import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { loadRecent } from '../recent'
import type { DirListing } from '../types'

const photoCount = (n: number | null) =>
  n === null ? 'no access' : n === 0 ? '' : `${n} photo${n === 1 ? '' : 's'}`

interface Props {
  start: string | null
  onPick: (folder: string) => void
  onClose: () => void
}

export function FolderPicker({ start, onPick, onClose }: Props) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const recent = loadRecent()

  const go = useCallback(async (path?: string) => {
    setError(null)
    try {
      setListing(await api.dirs(path))
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    go(start ?? undefined)
  }, [go, start])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-bg" onClick={onClose}>
      <div
        className="modal picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a folder"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Choose a photo folder</h3>
        <div className="places">
          {listing?.places.map((p) => (
            <button key={p.path} onClick={() => go(p.path)}>
              {p.name}
            </button>
          ))}
        </div>
        {recent.length > 0 && (
          <div className="recent">
            <span className="muted small">Recent:</span>
            {recent.map((f) => (
              <button key={f} className="link" title={f} onClick={() => onPick(f)}>
                {f.split('/').filter(Boolean).pop() ?? f}
              </button>
            ))}
          </div>
        )}
        {listing && (
          <>
            <div className="crumb">
              <button
                onClick={() => listing.parent && go(listing.parent)}
                disabled={!listing.parent}
                title="Up one folder"
              >
                ↑
              </button>
              <code title={listing.path}>{listing.path}</code>
            </div>
            <ul className="dirs">
              {listing.dirs.map((d) => (
                <li key={d.path}>
                  <button className="dir" onClick={() => go(d.path)} disabled={d.photos === null}>
                    <span>📁 {d.name}</span>
                    <span className="muted small">{photoCount(d.photos)}</span>
                  </button>
                </li>
              ))}
              {!listing.dirs.length && <li className="muted small">No sub-folders</li>}
              {listing.truncated && <li className="muted small">Showing the first 500 folders</li>}
            </ul>
          </>
        )}
        {error && <p className="red">{error}</p>}
        <form
          className="paste"
          onSubmit={(e) => {
            e.preventDefault()
            if (typed.trim()) onPick(typed.trim())
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="…or paste a folder path, e.g. /Users/you/Pictures/trip"
            aria-label="Folder path"
            spellCheck={false}
          />
          <button type="submit" disabled={!typed.trim()}>
            Open path
          </button>
        </form>
        <div className="modal-actions">
          <span className="muted small grow">
            {listing && listing.photos ? `${photoCount(listing.photos)} in this folder` : ''}
          </span>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={!listing?.photos}
            onClick={() => listing && onPick(listing.path)}
          >
            Open this folder
          </button>
        </div>
      </div>
    </div>
  )
}
