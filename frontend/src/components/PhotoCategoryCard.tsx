import type { Decisions } from '../decisions'
import type { PhotoSet } from '../sets'
import { FolderIcon } from './icons'
import { PhotoThumbnail } from './PhotoThumbnail'

const STRIP = 7

interface Props {
  set: PhotoSet
  decisions: Decisions
  version: number
  active: boolean
  /** near the top of the page: load thumbnails right away instead of lazily */
  eager: boolean
  onSelect: () => void
}

/** Folder card: icon, name, count and a row of small square thumbnails of the set.
 *  The suggested best photo comes first; photos marked for deletion are dimmed. */
export function PhotoCategoryCard({ set, decisions, version, active, eager, onSelect }: Props) {
  const ordered = set.best
    ? [set.photos.find((p) => p.id === set.best)!, ...set.photos.filter((p) => p.id !== set.best)]
    : set.photos
  const shown = ordered.slice(0, STRIP)
  const more = set.photos.length - shown.length
  const marked = set.photos.filter((p) => decisions[p.id]?.delete).length
  const detail = `${set.subtitle}${marked ? ` · ${marked} marked to delete` : ''}`
  return (
    <button
      className={`setcard${active ? ' active' : ''}`}
      onClick={onSelect}
      aria-pressed={active}
      title={detail}
      aria-label={`${set.title}, ${set.photos.length} photo${set.photos.length === 1 ? '' : 's'}, ${detail}. Open`}
    >
      <span className="setcard-head">
        <FolderIcon />
        <span className="setcard-title">{set.title}</span>
        <span className="setcard-count">{set.photos.length}</span>
      </span>
      <span className="strip">
        {shown.map((p, i) => (
          <span
            key={p.id}
            className={`strip-cell${decisions[p.id]?.delete ? ' dim' : ''}`}
            data-photo={p.id}
            data-more={i === shown.length - 1 && more > 0 ? `+${more}` : undefined}
          >
            <PhotoThumbnail photo={p} version={version} eager={eager} />
          </span>
        ))}
      </span>
    </button>
  )
}
