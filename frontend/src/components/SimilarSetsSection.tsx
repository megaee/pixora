import type { Decisions } from '../decisions'
import type { PhotoSet, SetSort } from '../sets'
import type { CategoryInfo } from '../types'
import { PhotoThumbnail } from './PhotoThumbnail'

interface Props {
  sets: PhotoSet[]
  /** before filtering, to tell "no sets" from "nothing matches" */
  total: number
  categories: CategoryInfo[] | null
  query: string
  category: string
  sort: SetSort
  onQuery: (q: string) => void
  onCategory: (c: string) => void
  onSort: (s: SetSort) => void
  decisions: Decisions
  version: number
  hasEdits: boolean
  canRerun: boolean
  onOpen: (key: string) => void
  onResetEdits: () => void
  onRerun: () => void
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** Look-alike photos (visual similarity), separate from content categories. */
export function SimilarSetsSection(props: Props) {
  const { sets, total, categories, query, category, sort } = props
  const { onQuery, onCategory, onSort, decisions, version, hasEdits, canRerun } = props
  return (
    <section className="similar" aria-labelledby="similar-title">
      <div className="section-head">
        <h2 id="similar-title" className="serif-title dotted">
          Similar sets
        </h2>
        <span className="muted small">
          photos that look alike · {total} {total === 1 ? 'set' : 'sets'}
        </span>
      </div>
      <div className="setbar" role="search">
        <input
          type="search"
          value={query}
          placeholder="Search sets, categories or file names"
          aria-label="Search sets"
          onChange={(e) => onQuery(e.target.value)}
        />
        <select
          value={category}
          aria-label="Filter by category"
          onChange={(e) => onCategory(e.target.value)}
          disabled={!categories}
          title={categories ? '' : 'Sort photos into categories first'}
        >
          <option value="">All categories</option>
          {categories
            ?.filter((c) => c.count > 0)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
        </select>
        <select
          value={sort}
          aria-label="Sort sets"
          onChange={(e) => onSort(e.target.value as SetSort)}
        >
          <option value="count">Most photos</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <span className="spacer" />
        {hasEdits && (
          <button className="link small" onClick={props.onResetEdits}>
            Undo my set edits
          </button>
        )}
        {canRerun && (
          <button className="link small" onClick={props.onRerun}>
            Re-run classification
          </button>
        )}
      </div>
      {sets.length === 0 ? (
        <p className="muted small">
          {total ? 'No set matches.' : 'No similar photos found at this strictness.'}
        </p>
      ) : (
        <div className="simgrid">
          {sets.map((s) => {
            const cover = s.photos.find((p) => p.id === s.best) ?? s.photos[0]
            const rest = s.photos.filter((p) => p !== cover).slice(0, 5)
            const marked = s.photos.filter((p) => decisions[p.id]?.delete).length
            return (
              <button
                key={s.key}
                className="simcard"
                onClick={() => props.onOpen(s.key)}
                aria-label={`Open ${s.title}, ${s.photos.length} photos, ${s.subtitle}`}
              >
                <span className="simcover">
                  <PhotoThumbnail photo={cover} version={version} />
                  <span className="simcount">{s.photos.length}</span>
                </span>
                <span className="simbody">
                  <span className="simtitle">{s.title}</span>
                  <span className="muted small">
                    {s.subtitle}
                    {s.cohesion && ` · ${pct(s.cohesion.value)} alike`}
                    {s.manual && ' · edited'}
                  </span>
                  <span className="simstrip">
                    {rest.map((p) => (
                      <span
                        key={p.id}
                        className={`strip-cell${decisions[p.id]?.delete ? ' dim' : ''}`}
                      >
                        <PhotoThumbnail photo={p} version={version} />
                      </span>
                    ))}
                  </span>
                  {marked > 0 && <span className="small red">{marked} marked to delete</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
