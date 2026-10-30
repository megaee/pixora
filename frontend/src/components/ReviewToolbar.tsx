import { isWeb, mb } from '../api'
import type { GroupMode, LibraryState, ShrinkOptions } from '../types'

interface Props {
  lib: LibraryState
  mode: GroupMode
  level: number
  levelReady: boolean
  onMode: (m: GroupMode) => void
  onLevel: (v: number) => void
  onLevelDone: () => void
  onAutoKeep: (keep: number) => void
  shrink: ShrinkOptions
  onShrink: (s: ShrinkOptions) => void
  deleted: number
  edited: number
  freed: number
  canApply: boolean
  onApply: () => void
}

/** Sticky bar above the review: grouping mode and strictness, auto-keep, shrink, Apply. */
export function ReviewToolbar(props: Props) {
  const { lib, mode, level, levelReady, onMode, onLevel, onLevelDone, onAutoKeep } = props
  const { shrink, onShrink, deleted, edited, freed, canApply, onApply } = props
  return (
    <div className="toolbar" role="toolbar" aria-label="Review settings">
      <label
        className="switch"
        title={
          isWeb
            ? 'AI mode needs the Pixora desktop app'
            : lib.ai.available
              ? `Group and rank with local AI models: ${lib.ai.models.join(', ')}`
              : 'Not installed: run `make setup-ai`, then restart the app'
        }
      >
        <input
          type="checkbox"
          role="switch"
          aria-label="AI mode"
          checked={mode === 'ai'}
          disabled={!lib.ai.available}
          onChange={(e) => onMode(e.target.checked ? 'ai' : 'classic')}
        />
        <span className="track" aria-hidden="true" />
        AI mode
      </label>
      <label className="ctl">
        {mode === 'ai' ? 'Match ≥' : 'Similarity'}
        <input
          type="range"
          aria-label={mode === 'ai' ? 'Minimum AI similarity' : 'Similarity threshold'}
          min={mode === 'ai' ? 85 : 6}
          max={mode === 'ai' ? 99 : 70}
          step={mode === 'ai' ? 1 : 2}
          value={level}
          disabled={!levelReady}
          onChange={(e) => onLevel(+e.target.value)}
          onMouseUp={onLevelDone}
          onKeyUp={onLevelDone}
          onTouchEnd={onLevelDone}
        />
        <span className="num">{mode === 'ai' ? `${level}%` : level}</span>
      </label>
      <span className="ctl seg" role="group" aria-label="Auto-keep per set">
        <span className="seg-label">Keep</span>
        <button onClick={() => onAutoKeep(1)}>Best 1</button>
        <button onClick={() => onAutoKeep(2)}>Best 2</button>
        <button onClick={() => onAutoKeep(1e9)}>All</button>
      </span>
      <label className="ctl" hidden={isWeb}>
        Shrink
        <select
          value={shrink.max_side}
          onChange={(e) => onShrink({ ...shrink, max_side: +e.target.value })}
        >
          {[4000, 3000, 2048, 1600].map((v) => (
            <option key={v} value={v}>
              {v} px
            </option>
          ))}
        </select>
        <select
          value={shrink.quality}
          aria-label="JPEG quality"
          onChange={(e) => onShrink({ ...shrink, quality: +e.target.value })}
        >
          {[92, 85, 75].map((v) => (
            <option key={v} value={v}>
              q{v}
            </option>
          ))}
        </select>
      </label>
      <span className="summary">
        <span>
          Delete <b>{deleted}</b>
        </span>
        <span>
          Edit <b>{edited}</b>
        </span>
        <span>
          Frees ≈ <b>{mb(freed)}</b>
        </span>
        <button className="primary" disabled={!canApply} onClick={onApply}>
          Apply changes…
        </button>
      </span>
    </div>
  )
}
