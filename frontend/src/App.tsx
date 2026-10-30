import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, mb } from './api'
import { ApplyModal } from './components/ApplyModal'
import { GroupSection } from './components/GroupSection'
import { Lightbox } from './components/Lightbox'
import { autoSelect, summarise, type Decisions } from './decisions'
import type { Decision, Group, LibraryState, ShrinkOptions } from './types'

const DEFAULT_THRESHOLD = 22

export default function App() {
  const [lib, setLib] = useState<LibraryState | null>(null)
  const [folderInput, setFolderInput] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [decisions, setDecisions] = useState<Decisions>({})
  const [shrink, setShrink] = useState<ShrinkOptions>({ max_side: 3000, quality: 85 })
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0) // bumps after apply to refresh thumbnails

  // ---- library status (poll while scanning)
  const refreshLibrary = useCallback(async () => {
    const s = await api.library()
    setLib(s)
    if (s.folder) setFolderInput((v) => v || s.folder!)
    return s
  }, [])

  useEffect(() => {
    refreshLibrary().catch((e) => setError(String(e)))
  }, [refreshLibrary])

  useEffect(() => {
    if (lib?.status !== 'scanning') return
    const t = setInterval(() => refreshLibrary().catch(() => {}), 500)
    return () => clearInterval(t)
  }, [lib?.status, refreshLibrary])

  // ---- groups
  const loadGroups = useCallback(async (t: number, keepPrev = true) => {
    const data = await api.groups(t)
    setGroups(data.groups)
    setDecisions((prev) => autoSelect(data.groups, 1, keepPrev ? prev : {}))
  }, [])

  useEffect(() => {
    if (lib?.status === 'ready') loadGroups(threshold, false).catch((e) => setError(String(e)))
    // only when a scan finishes / folder changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib?.status, lib?.folder, version])

  const openFolder = async () => {
    setError(null)
    setGroups([])
    try {
      setLib(await api.openFolder(folderInput.trim()))
    } catch (e) {
      setError(String(e))
    }
  }

  const multi = groups.filter((g) => g.photos.length > 1)
  const singles = groups.filter((g) => g.photos.length === 1)
  const allPhotos = useMemo(() => groups.flatMap((g) => g.photos), [groups])
  const { deleted, edited, freed } = summarise(allPhotos, decisions)

  const setOne = useCallback(
    (id: string, d: Decision) => setDecisions((prev) => ({ ...prev, [id]: d })),
    [],
  )
  const setMany = (patch: Decisions) => setDecisions((prev) => ({ ...prev, ...patch }))
  const openPreview = (id: string) => setLightbox(allPhotos.findIndex((p) => p.id === id))

  return (
    <>
      <header className="topbar">
        <div className="row">
          <h1>📷 Photo Cleanup</h1>
          <form
            className="folder"
            onSubmit={(e) => {
              e.preventDefault()
              openFolder()
            }}
          >
            <input
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="/Users/you/Pictures/trip  (paste a folder path)"
              spellCheck={false}
            />
            <button type="submit" disabled={!folderInput.trim()}>
              Open folder
            </button>
          </form>
        </div>
        {lib?.status === 'ready' && groups.length > 0 && (
          <div className="row controls">
            <label className="ctl">
              Similarity
              <input
                type="range"
                min={6}
                max={70}
                step={2}
                value={threshold}
                onChange={(e) => setThreshold(+e.target.value)}
                onMouseUp={() => loadGroups(threshold)}
                onKeyUp={() => loadGroups(threshold)}
                onTouchEnd={() => loadGroups(threshold)}
              />
              <span className="num">{threshold}</span>
            </label>
            <span className="ctl">
              Auto-keep
              <button onClick={() => setDecisions((p) => autoSelect(groups, 1, p))}>Best 1</button>
              <button onClick={() => setDecisions((p) => autoSelect(groups, 2, p))}>Best 2</button>
              <button onClick={() => setDecisions((p) => autoSelect(groups, 1e9, p))}>
                Keep all
              </button>
            </span>
            <label className="ctl">
              Shrink to
              <select
                value={shrink.max_side}
                onChange={(e) => setShrink({ ...shrink, max_side: +e.target.value })}
              >
                {[4000, 3000, 2048, 1600].map((v) => (
                  <option key={v} value={v}>
                    {v} px
                  </option>
                ))}
              </select>
              <select
                value={shrink.quality}
                onChange={(e) => setShrink({ ...shrink, quality: +e.target.value })}
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
              <button
                className="primary"
                disabled={!deleted && !edited}
                onClick={() => setConfirming(true)}
              >
                Apply changes…
              </button>
            </span>
          </div>
        )}
      </header>

      <main>
        {error && <div className="error">{error}</div>}
        {!lib?.folder && !error && (
          <div className="empty">
            <h2>Pick a folder to start</h2>
            <p>
              Paste the full path of a photo folder above. Similar photos are grouped, the best one
              is suggested, and nothing changes until you press <b>Apply</b>.
            </p>
          </div>
        )}
        {lib?.status === 'scanning' && (
          <div className="scan">
            <p>
              Analysing photos… {lib.progress} / {lib.total}
            </p>
            <progress value={lib.progress} max={lib.total || 1} />
          </div>
        )}
        {lib?.status === 'error' && <div className="error">{lib.error}</div>}
        {lib?.status === 'ready' && (
          <>
            <p className="muted info">
              {lib.count} photos · {mb(lib.total_size)} · {multi.length} similar group(s),{' '}
              {singles.length} unique · deleted photos go to the {lib.trash}
            </p>
            {lib.count === 0 && <div className="empty">No photos found in this folder.</div>}
            {multi.map((g, i) => (
              <GroupSection
                key={g.photos[0].id}
                title={`Group ${i + 1}`}
                subtitle={`${g.photos.length} similar photos`}
                photos={g.photos}
                best={g.best}
                decisions={decisions}
                version={version}
                onChange={setOne}
                onBulk={setMany}
                onOpen={openPreview}
              />
            ))}
            {singles.length > 0 && (
              <GroupSection
                title="Unique photos"
                subtitle="no close match"
                photos={singles.map((g) => g.photos[0])}
                best={null}
                decisions={decisions}
                version={version}
                onChange={setOne}
                onBulk={setMany}
                onOpen={openPreview}
              />
            )}
          </>
        )}
      </main>

      {lightbox !== null && allPhotos[lightbox] && (
        <Lightbox
          photos={allPhotos}
          index={lightbox}
          decisions={decisions}
          version={version}
          onIndex={setLightbox}
          onChange={setOne}
        />
      )}
      {confirming && (
        <ApplyModal
          photos={allPhotos}
          decisions={decisions}
          shrink={shrink}
          trash={lib?.trash ?? null}
          onClose={async (applied) => {
            setConfirming(false)
            if (applied) {
              setDecisions({})
              await refreshLibrary()
              setVersion((v) => v + 1)
            }
          }}
        />
      )}
    </>
  )
}
