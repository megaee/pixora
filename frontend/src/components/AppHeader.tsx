import type { ReactNode } from 'react'
import { FolderIcon, UndoIcon } from './icons'
import { Logo, TAGLINE } from './Logo'

interface Props {
  /** small context label after the brand, e.g. "AI sorting" */
  context: string
  title: ReactNode
  undoLabel: string | null
  onBrowse: () => void
  onUndo: () => void
}

/** Compact masthead: Pixora mark, brand line and the heading, folder + undo actions. */
export function AppHeader(props: Props) {
  const { context, title, undoLabel, onBrowse, onUndo } = props
  return (
    <header className="app-header">
      <span className="avatar" title={TAGLINE}>
        <Logo size={40} />
      </span>
      <div className="titles">
        <div className="brand-line">
          <b>Pixora</b> · {context}
        </div>
        <h1 className="headline">{title}</h1>
      </div>
      <div className="header-actions">
        {undoLabel && (
          <button className="ghost" onClick={onUndo} title={`Changes applied ${undoLabel}`}>
            <UndoIcon /> <span className="hide-sm">Undo last apply…</span>
          </button>
        )}
        <button className="ghost" onClick={onBrowse} aria-label="Browse for a folder">
          <FolderIcon /> <span className="hide-xs">Browse…</span>
        </button>
      </div>
    </header>
  )
}
