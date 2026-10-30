import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, isWeb, LIBRARY_CHANGED, mb } from './api'
import { browserSupported } from './web/engine'
import { AppHeader } from './components/AppHeader'
import { ApplyModal } from './components/ApplyModal'
import { CategoryStatus } from './components/CategoryStatus'
import { FileStatistics } from './components/FileStatistics'
import { FolderPicker } from './components/FolderPicker'
import { GalleryView } from './components/GalleryView'
import { GroupSection } from './components/GroupSection'
import { Lightbox } from './components/Lightbox'
import { TAGLINE } from './components/Logo'
import { PhotoCategorySection } from './components/PhotoCategorySection'
import { ReviewToolbar } from './components/ReviewToolbar'
import { SimilarSetsSection } from './components/SimilarSetsSection'
import { UndoModal } from './components/UndoModal'
import { UnsortedPhotoPile } from './components/UnsortedPhotoPile'
import { autoSelect, summarise, type Decisions } from './decisions'
import { rememberFolder } from './recent'
import { categoryCards, filterSets, toSets, type SetSort } from './sets'
import type {
  CategoryInfo,
  Decision,
  Group,
  GroupMode,
  LibraryState,
  ShrinkOptions,
  UndoPlan,
} from './types'

const DEFAULT_THRESHOLD = 22

const folderName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

/** What fills the page below the stats: the overview, or one set / category opened full size. */
type View = { kind: 'home' } | { kind: 'set'; key: string } | { kind: 'category'; id: string }

export default function App() {
  const [lib, setLib] = useState<LibraryState | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [categories, setCategories] = useState<CategoryInfo[] | null>(null)
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [mode, setMode] = useState<GroupMode>('classic')
  const [similarity, setSimilarity] = useState(95) // AI mode: minimum similarity in %
  const [decisions, setDecisions] = useState<Decisions>({})
  const [shrink, setShrink] = useState<ShrinkOptions>({ max_side: 3000, quality: 85 })
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [undoPlan, setUndoPlan] = useState<UndoPlan | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [activeSet, setActiveSet] = useState<string | null>(null) // filter the review to one set
  const [view, setView] = useState<View>({ kind: 'home' })
  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [sort, setSort] = useState<SetSort>('count')
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0) // bumps after apply to refresh thumbnails

  // ---- library status (poll while scanning or analysing)
  const refreshLibrary = useCallback(async () => {
    const s = await api.library()
    setLib(s)
    return s
  }, [])

  useEffect(() => {
    refreshLibrary().catch((e) => setError(String(e)))
    const reopened = () => {
      setGroups([])
      setView({ kind: 'home' })
      refreshLibrary().catch((e) => setError(String(e)))
    }
    window.addEventListener(LIBRARY_CHANGED, reopened)
    return () => window.removeEventListener(LIBRARY_CHANGED, reopened)
  }, [refreshLibrary])

  const aiStatus = lib?.ai.status
  const aiBusy = aiStatus === 'loading' || aiStatus === 'running'
  const aiReady = aiStatus === 'ready'
  const sorted = mode === 'classic' || aiReady // groups on screen match the chosen mode

  useEffect(() => {
    if (lib?.status !== 'scanning' && !aiBusy) return
    const t = setInterval(() => refreshLibrary().catch(() => {}), 500)
    return () => clearInterval(t)
  }, [lib?.status, aiBusy, refreshLibrary])

  // ---- groups (similar sets) and content categories
  const loadGroups = useCallback(async (m: GroupMode, value: number, keepPrev = true) => {
    const data = await api.groups(m, value)
    setGroups(data.groups)
    setDecisions((prev) => autoSelect(data.groups, 1, keepPrev ? prev : {}))
  }, [])
  const loadCategories = useCallback(async () => {
    setCategories((await api.categories()).categories)
  }, [])
  const level = mode === 'ai' ? similarity : threshold
  const reload = () => loadGroups(mode, level).catch((e) => setError(String(e)))

  useEffect(() => {
    if (lib?.status === 'ready' && sorted)
      loadGroups(mode, level, false).catch((e) => setError(String(e)))
    // only when a scan / AI analysis finishes, the folder or the mode changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib?.status, lib?.folder, version, mode, aiReady])

  useEffect(() => {
    if (lib?.status === 'ready' && aiReady) loadCategories().catch((e) => setError(String(e)))
    else setCategories(null)
  }, [lib?.status, lib?.folder, version, aiReady, loadCategories])

  // Previous groups stay on screen (pile, cards) while AI mode is still sorting.
  const switchMode = (m: GroupMode) => {
    setMode(m)
    if (m === 'ai' && !aiReady && !aiBusy)
      api
        .enableAI()
        .then(setLib)
        .catch((e) => setError(String(e)))
  }

  /** Run a saved change (category fix, merge, split…), then reload what it affects. */
  const edit = async (call: Promise<LibraryState>) => {
    setError(null)
    try {
      setLib(await call)
      await Promise.all([loadGroups(mode, level), aiReady ? loadCategories() : null])
    } catch (e) {
      setError(String(e))
    }
  }

  // ---- undo: is there an earlier apply in this folder's log that can be reversed?
  useEffect(() => {
    setUndoPlan(null)
    if (lib?.status === 'ready') api.undoPlan().then(setUndoPlan, () => {})
  }, [lib?.status, lib?.folder, version])

  /** Desktop: Pixora's own folder browser. Web: the browser's folder picker (needs this click). */
  const browse = () => {
    if (!api.pickFolder) return setPicking(true)
    setError(null)
    const before = lib?.folder
    api
      .pickFolder()
      .then((s) => {
        setLib(s)
        if (s.folder !== before || s.status === 'scanning') {
          setGroups([])
          setActiveSet(null)
          setView({ kind: 'home' })
        }
      })
      .catch((e) => setError(String(e)))
  }

  const openFolder = async (folder: string) => {
    setError(null)
    setGroups([])
    setActiveSet(null)
    setView({ kind: 'home' })
    try {
      const s = await api.openFolder(folder)
      setLib(s)
      if (s.folder) rememberFolder(s.folder)
    } catch (e) {
      setError(String(e))
    }
  }

  const allPhotos = useMemo(() => groups.flatMap((g) => g.photos), [groups])
  const byId = useMemo(() => new Map(allPhotos.map((p) => [p.id, p])), [allPhotos])
  const labels = useMemo(
    () => Object.fromEntries((categories ?? []).map((c) => [c.id, c.label])),
    [categories],
  )
  const sets = useMemo(() => toSets(groups, labels), [groups, labels])
  const similarSets = useMemo(() => sets.filter((s) => s.key !== 'unique'), [sets])
  const shownSimilar = filterSets(similarSets, { query, category: catFilter, sort }, labels)
  const catCards = useMemo(
    () => (categories ? categoryCards(categories, byId) : []),
    [categories, byId],
  )
  const { deleted, edited, freed } = summarise(allPhotos, decisions)
  const active = sets.some((s) => s.key === activeSet) ? activeSet : null
  const shownSets = active ? sets.filter((s) => s.key === active) : sets
  const grouping = !!lib && lib.count > 0 && groups.length === 0 // sets not loaded yet
  const hasEdits = groups.some((g) => g.manual)

  const setOne = useCallback(
    (id: string, d: Decision) => setDecisions((prev) => ({ ...prev, [id]: d })),
    [],
  )
  const setMany = (patch: Decisions) => setDecisions((prev) => ({ ...prev, ...patch }))
  const openPreview = (id: string) => setLightbox(allPhotos.findIndex((p) => p.id === id))
  const openView = (v: View) => {
    setView(v)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const reviewSet = (key: string) => {
    setActiveSet(key)
    setView({ kind: 'home' })
    setTimeout(() => document.getElementById('review')?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  // what is open full size (it can disappear after an edit, e.g. a merge: then go back home)
  const galleryCategory =
    view.kind === 'category' ? catCards.find((c) => c.key === `cat:${view.id}`) : undefined
  const gallerySet = view.kind === 'set' ? similarSets.find((s) => s.key === view.key) : undefined
  const gallery = galleryCategory ?? gallerySet
  useEffect(() => {
    if (view.kind !== 'home' && !gallery && groups.length) setView({ kind: 'home' })
  }, [view, gallery, groups.length])

  const ready = lib?.status === 'ready'
  const aiProgress = mode === 'ai' && aiBusy && lib && (
    <div className="scan">
      {aiStatus === 'loading' ? (
        <p>
          Loading the AI models… The first time, this downloads about 700 MB (once). Your photos
          stay on this computer.
        </p>
      ) : (
        <p>
          AI is sorting photos… {lib.ai.progress} / {lib.ai.total}
        </p>
      )}
      <progress
        value={aiStatus === 'loading' ? undefined : lib.ai.progress}
        max={lib.ai.total || 1}
      />
    </div>
  )
  const categoryPlaceholder =
    lib && !(aiReady && categories) ? (
      <CategoryStatus
        lib={lib}
        onStart={() => edit(api.enableAI())}
        onCancel={() => edit(api.cancelAI())}
      />
    ) : grouping ? (
      <div className="scan">Sorting photos…</div>
    ) : undefined

  return (
    <div className="page">
      <AppHeader
        context={aiReady ? 'AI sorting' : 'Photo review'}
        undoLabel={undoPlan?.batch ?? null}
        onBrowse={browse}
        onUndo={() => setUndoing(true)}
        title={
          lib?.folder ? (
            <>
              Sorting my <em>{folderName(lib.folder)}</em> folder
            </>
          ) : (
            <>
              Pick a <em>folder</em> to start
            </>
          )
        }
      />

      <main>
        {error && (
          <div className="error">
            {error}{' '}
            <button className="link" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        {!lib?.folder && !error && (
          <div className="empty">
            <p>
              <b>{TAGLINE}</b> Pixora sorts photos by what they show, finds similar shots and
              suggests the best one. It runs on this computer, and nothing on disk changes until you
              press <b>Apply</b>.
            </p>
            {isWeb && (
              <p className="small">
                This web edition works entirely inside your browser: your photos are read from the
                folder you pick and are never uploaded. Chrome and Edge can also apply changes
                (after asking you); other browsers can review only.
              </p>
            )}
            {isWeb && !browserSupported() && (
              <p className="red small">
                This browser is missing features Pixora needs (Web Workers, OffscreenCanvas). Please
                use a current Chrome, Edge, Firefox or Safari.
              </p>
            )}
            <button className="primary" onClick={browse}>
              Browse for a folder…
            </button>
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

        {ready && lib && (
          <>
            <FileStatistics
              stats={[
                { label: 'Total files', value: lib.files, hint: `${mb(lib.total_size)} of photos` },
                {
                  label: 'Videos',
                  value: lib.videos,
                  dot: 'dark',
                  hint: 'Videos are counted but never changed',
                },
                {
                  label: 'Photos',
                  value: lib.count,
                  dot: 'soft',
                  hint: lib.files ? `${Math.round((lib.count / lib.files) * 100)}% of files` : '',
                },
                {
                  label: 'Sets created',
                  value: sorted && !grouping ? similarSets.length : null,
                  hint: 'Similar sets found or edited by you. Pixora never creates folders on disk.',
                },
              ]}
            />
            {lib.skipped_count > 0 && (
              <p className="notice">
                {lib.skipped_count} file{lib.skipped_count === 1 ? '' : 's'} could not be read
                (damaged or unsupported) and {lib.skipped_count === 1 ? 'is' : 'are'} left out:{' '}
                {lib.skipped.join(', ')}
                {lib.skipped_count > lib.skipped.length ? '…' : ''}
              </p>
            )}

            {lib.count > 0 && gallery && (
              <GalleryView
                key={gallery.key}
                set={gallery}
                kind={view.kind === 'category' ? 'category' : 'set'}
                categories={categories}
                labels={labels}
                secondary={
                  view.kind === 'category'
                    ? new Set(categories?.find((c) => c.id === view.id)?.secondary)
                    : undefined
                }
                version={version}
                mergeTargets={similarSets.filter((s) => s.key !== gallery.key)}
                onBack={() => setView({ kind: 'home' })}
                onOpenPhoto={openPreview}
                onCategory={(id, c) => edit(api.setCategory(id, c))}
                onExclude={(id) => edit(api.excludeFromSet(id))}
                onSplit={(sel) =>
                  edit(
                    api.splitSet(
                      gallery.photos.map((p) => p.id),
                      sel,
                    ),
                  )
                }
                onMerge={(targetKey) => {
                  const target = similarSets.find((s) => s.key === targetKey)
                  if (target)
                    edit(
                      api.mergeSets(
                        gallery.photos.map((p) => p.id),
                        target.photos.map((p) => p.id),
                      ),
                    )
                }}
                onReview={() => reviewSet(gallery.key)}
              />
            )}

            {lib.count > 0 && !gallery && (
              <>
                <section className="overview">
                  <PhotoCategorySection
                    meta={
                      categories
                        ? `${catCards.length} ${catCards.length === 1 ? 'category' : 'categories'}`
                        : 'by what they show'
                    }
                    sets={catCards}
                    decisions={decisions}
                    version={version}
                    active={null}
                    onSelect={(key) => openView({ kind: 'category', id: key.slice(4) })}
                    placeholder={categoryPlaceholder}
                  />
                  <UnsortedPhotoPile photos={allPhotos} version={version} onOpen={openPreview} />
                </section>

                {sorted && !grouping && (
                  <SimilarSetsSection
                    sets={shownSimilar}
                    total={similarSets.length}
                    categories={categories}
                    query={query}
                    category={catFilter}
                    sort={sort}
                    onQuery={setQuery}
                    onCategory={setCatFilter}
                    onSort={setSort}
                    decisions={decisions}
                    version={version}
                    hasEdits={hasEdits}
                    canRerun={aiReady}
                    onOpen={(key) => openView({ kind: 'set', key })}
                    onResetEdits={() => edit(api.resetSets())}
                    onRerun={() => edit(api.rerunAI())}
                  />
                )}

                <section className="review" id="review" aria-labelledby="review-title">
                  <div className="section-head">
                    <h2 id="review-title" className="serif-title">
                      Review
                    </h2>
                    <span className="muted small">
                      keep the best, clean up the rest ·{' '}
                      {lib.can_write === false
                        ? 'read-only in this browser (use Chrome or Edge to apply changes)'
                        : `deleted photos go to the ${lib.trash}`}
                      {mode === 'ai' && ' · ★ = highest AI quality'}
                    </span>
                  </div>
                  <ReviewToolbar
                    lib={lib}
                    mode={mode}
                    level={level}
                    levelReady={sorted}
                    onMode={switchMode}
                    onLevel={(v) => (mode === 'ai' ? setSimilarity : setThreshold)(v)}
                    onLevelDone={reload}
                    onAutoKeep={(keep) => setDecisions((p) => autoSelect(groups, keep, p))}
                    shrink={shrink}
                    onShrink={setShrink}
                    deleted={deleted}
                    edited={edited}
                    freed={freed}
                    canApply={sorted && lib.can_write !== false && (deleted > 0 || edited > 0)}
                    onApply={() => setConfirming(true)}
                  />
                  {mode === 'ai' && aiStatus === 'error' && (
                    <div className="error">
                      AI mode failed: {lib.ai.error}{' '}
                      <button onClick={() => switchMode('ai')}>Try again</button>
                    </div>
                  )}
                  {aiProgress}
                  {sorted && active && (
                    <div className="filter-note">
                      Showing <b>{sets.find((s) => s.key === active)?.title}</b> only
                      <button className="link" onClick={() => setActiveSet(null)}>
                        Show all sets
                      </button>
                    </div>
                  )}
                  {sorted &&
                    shownSets.map((s) => (
                      <GroupSection
                        key={s.key}
                        title={s.title}
                        subtitle={
                          s.key === 'unique'
                            ? `${s.photos.length} with no close match`
                            : `${s.photos.length} similar photos · ${s.subtitle}`
                        }
                        photos={s.photos}
                        best={s.best}
                        decisions={decisions}
                        version={version}
                        onChange={setOne}
                        onBulk={setMany}
                        onOpen={openPreview}
                      />
                    ))}
                </section>
              </>
            )}
            {lib.count === 0 && <div className="empty">No photos found in this folder.</div>}
          </>
        )}
      </main>
      <footer className="footer muted small">
        Pixora{isWeb ? ' web edition' : ''} · {TAGLINE} Runs locally; photos never leave this
        computer.
        {import.meta.env.VITE_REPO_URL && (
          <>
            {' '}
            <a href={import.meta.env.VITE_REPO_URL}>Source &amp; desktop app on GitHub</a>
          </>
        )}
      </footer>

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
      {picking && (
        <FolderPicker
          start={lib?.folder ?? null}
          onClose={() => setPicking(false)}
          onPick={(folder) => {
            setPicking(false)
            openFolder(folder)
          }}
        />
      )}
      {undoing && undoPlan && (
        <UndoModal
          plan={undoPlan}
          onClose={async (undone) => {
            setUndoing(false)
            if (undone) {
              await refreshLibrary()
              setVersion((v) => v + 1)
            }
          }}
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
    </div>
  )
}
