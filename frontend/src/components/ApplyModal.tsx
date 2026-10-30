import { useState } from 'react'
import { api, mb } from '../api'
import { describe, isChanged, type Decisions } from '../decisions'
import type { ApplyResult, PhotoInfo, ShrinkOptions } from '../types'

interface Props {
  photos: PhotoInfo[]
  decisions: Decisions
  shrink: ShrinkOptions
  trash: string | null
  onClose: (applied: boolean) => void
}

export function ApplyModal({ photos, decisions, shrink, trash, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const changed = photos.filter((p) => isChanged(decisions[p.id]))
  const del = changed.filter((p) => decisions[p.id].delete)
  const edit = changed.filter((p) => !decisions[p.id].delete)
  const anyShrink = edit.some((p) => decisions[p.id].shrink)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const pending = Object.fromEntries(changed.map((p) => [p.id, decisions[p.id]]))
      setResult(await api.apply(pending, shrink))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-bg">
      <div className="modal" role="dialog" aria-modal="true">
        {result ? (
          <>
            <h3>Done — freed {mb(result.freed)}</h3>
            <ul>
              {result.results.map((r) => (
                <li key={r.id} className={r.ok ? '' : 'red'}>
                  {r.id}: {r.message}
                </li>
              ))}
            </ul>
            <p className="muted small">Log: {result.log}</p>
            <div className="modal-actions">
              <button className="primary" onClick={() => onClose(true)}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>Review changes</h3>
            {del.length > 0 && (
              <>
                <b>
                  Move to {trash ?? 'trash'} ({del.length})
                </b>
                <ul>
                  {del.map((p) => (
                    <li key={p.id}>
                      {p.name} — {mb(p.size)}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {edit.length > 0 && (
              <>
                <b>Modify ({edit.length})</b>
                <ul>
                  {edit.map((p) => (
                    <li key={p.id}>
                      {p.name} — {describe(decisions[p.id]).join(', ')}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {anyShrink && (
              <p className="warn">
                Shrink overwrites the file (max {shrink.max_side}px, quality {shrink.quality}). This
                cannot be undone.
              </p>
            )}
            {error && <p className="red">{error}</p>}
            <div className="modal-actions">
              <button onClick={() => onClose(false)} disabled={busy}>
                Cancel
              </button>
              <button className="primary" onClick={run} disabled={busy || !changed.length}>
                {busy ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
