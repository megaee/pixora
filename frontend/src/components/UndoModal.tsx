import { useState } from 'react'
import { api } from '../api'
import type { UndoPlan, UndoResult } from '../types'

interface Props {
  plan: UndoPlan
  onClose: (undone: boolean) => void
}

export function UndoModal({ plan, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UndoResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const doable = plan.items.filter((i) => i.ok)
  const skipped = plan.items.filter((i) => !i.ok)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      setResult(await api.undo())
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
            <h3>Undo finished</h3>
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
            <h3>Undo changes from {plan.batch}</h3>
            {doable.length > 0 && (
              <>
                <b>Will undo ({doable.length})</b>
                <ul>
                  {doable.map((i) => (
                    <li key={i.id + i.action}>
                      {i.id} — {i.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {skipped.length > 0 && (
              <>
                <b>Can't undo ({skipped.length})</b>
                <ul>
                  {skipped.map((i) => (
                    <li key={i.id + i.action} className="warn">
                      {i.id} — {i.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {error && <p className="red">{error}</p>}
            <div className="modal-actions">
              <button onClick={() => onClose(false)} disabled={busy}>
                Cancel
              </button>
              <button className="primary" onClick={run} disabled={busy}>
                {busy ? 'Undoing…' : doable.length ? 'Undo' : 'Mark as handled'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
