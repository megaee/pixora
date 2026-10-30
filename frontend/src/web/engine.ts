/** Pixora web edition: the same API the desktop app's Python server offers, implemented inside the
 *  browser tab. Photos are read from a folder the visitor picks and never leave the computer.
 *
 *  - Chrome / Edge (File System Access API): the folder is opened read-only; write access is asked
 *    for only when the visitor presses Apply or Undo. "Delete" moves photos into a `_to_delete`
 *    sub-folder (browsers cannot use the system Trash), rotation patches the EXIF orientation tag.
 *  - Other browsers: a folder upload field gives read-only access: review, but no changes.
 *  - Not available here: AI categories / AI mode and shrinking (desktop app only).
 */
import type {
  ApplyResult,
  Decision,
  Group,
  LibraryState,
  PhotoInfo,
  UndoPlan,
  UndoResult,
} from '../types'
import { distance, groupPhotos } from './analysis'
import { patchOrientation } from './exif'
import type { WorkerResponse } from './worker'

const IMAGE_EXT = /\.(jpe?g|png|webp|bmp|avif|gif|tiff?|heic|heif)$/i
const VIDEO_EXT = /\.(mp4|mov|m4v|avi|mkv|webm|mts|m2ts|3gp|wmv)$/i
const TRASH = '_to_delete'
const LOG_NAME = 'photo_cleanup_log.csv'
const LOG_HEADER = ['time', 'file', 'action', 'detail', 'bytes_before', 'bytes_after']
export const DESKTOP_ONLY = 'This needs the Pixora desktop app (it runs local AI models).'
export const READ_ONLY =
  'This browser can only read folders. To delete or rotate photos, use Chrome or Edge, or the Pixora desktop app.'

interface Entry {
  name: string
  file: File
  handle?: FileSystemFileHandle
}

interface WebPhoto {
  info: PhotoInfo
  time: number
  hashes: Uint32Array[]
  thumbUrl: string
}

interface Batch {
  time: string
  undone: boolean
  items: { id: string; action: 'delete' | 'rotate'; detail: string; turns?: number }[]
}

const keyOf = (f: File) => `${f.name}|${f.size}|${f.lastModified}`

function localIso(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const nowText = () => localIso(Date.now()).replace('T', ' ')

function csvLine(cells: (string | number)[]): string {
  return (
    cells
      .map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c))
      .join(',') + '\n'
  )
}

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: edits last until the tab is closed */
  }
}

export const browserSupported = () =>
  typeof Worker !== 'undefined' &&
  typeof OffscreenCanvas !== 'undefined' &&
  typeof createImageBitmap !== 'undefined'

/** A few image decoders in Web Workers, so big folders do not freeze the page. */
class WorkerPool {
  private workers: Worker[] = []
  private idle: Worker[] = []
  private queue: { file: File; id: string; resolve: (r: WorkerResponse) => void }[] = []
  private pending = new Map<string, (r: WorkerResponse) => void>()
  private seq = 0

  run(file: File): Promise<WorkerResponse> {
    const id = String(++this.seq)
    return new Promise((resolve) => {
      this.queue.push({ file, id, resolve })
      this.pump()
    })
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      this.pending.get(e.data.id)?.(e.data)
      this.pending.delete(e.data.id)
      this.idle.push(w)
      this.pump()
    }
    w.onerror = (e) => {
      for (const [id, resolve] of this.pending) resolve({ id, ok: false, error: e.message })
      this.pending.clear()
    }
    this.workers.push(w)
    return w
  }

  private pump() {
    while (this.queue.length) {
      const max = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))
      const w = this.idle.pop() ?? (this.workers.length < max ? this.spawn() : null)
      if (!w) return
      const job = this.queue.shift()!
      this.pending.set(job.id, job.resolve)
      w.postMessage({ id: job.id, file: job.file })
    }
  }
}

export class WebEngine {
  private dir: FileSystemDirectoryHandle | null = null
  private folder: string | null = null
  private entries = new Map<string, Entry>()
  private photos = new Map<string, WebPhoto>()
  private cache = new Map<string, WebPhoto | null>() // keyOf(file) -> analysis (null = unreadable)
  private previews = new Map<string, string>()
  private pool = new WorkerPool()
  private status: LibraryState['status'] = 'idle'
  private progress = 0
  private total = 0
  private error: string | null = null
  private skipped: string[] = []
  private manualSets: string[][] = []

  // ------------------------------------------------------------------ opening a folder
  /** Must be called from a click: browsers only show folder pickers for a user gesture. */
  pickFolder(): Promise<LibraryState> {
    const picker = (window as unknown as { showDirectoryPicker?: ShowDirectoryPicker })
      .showDirectoryPicker
    if (picker) {
      return picker({ id: 'pixora', mode: 'read' }).then(
        (dir) => this.openDirectory(dir),
        (e: DOMException) => {
          if (e.name === 'AbortError') return this.library() // picker closed
          throw e
        },
      )
    }
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.webkitdirectory = true
      input.addEventListener('change', () => resolve(this.openFiles([...(input.files ?? [])])))
      input.addEventListener('cancel', () => resolve(this.library()))
      input.click()
    })
  }

  /** Read-write capable path (Chrome / Edge). Only the folder's own files, not sub-folders. */
  async openDirectory(dir: FileSystemDirectoryHandle): Promise<LibraryState> {
    const entries: Entry[] = []
    for await (const handle of (dir as unknown as AsyncDirectory).values())
      if (handle.kind === 'file' && !handle.name.startsWith('.')) {
        const fh = handle as FileSystemFileHandle
        entries.push({ name: fh.name, file: await fh.getFile(), handle: fh })
      }
    this.reset(dir.name)
    this.dir = dir
    this.setEntries(entries)
    void this.scan()
    return this.library()
  }

  /** Read-only path (folder upload field): top-level files of the chosen folder. */
  openFiles(files: File[]): Promise<LibraryState> {
    const top = files.filter((f) => (f.webkitRelativePath || f.name).split('/').length <= 2)
    if (!top.length) return this.library()
    this.reset((top[0].webkitRelativePath || top[0].name).split('/')[0] || 'Selected photos')
    this.setEntries(
      top.filter((f) => !f.name.startsWith('.')).map((f) => ({ name: f.name, file: f })),
    )
    void this.scan()
    return this.library()
  }

  private reset(folder: string) {
    for (const url of this.previews.values()) URL.revokeObjectURL(url)
    for (const p of this.cache.values()) if (p) URL.revokeObjectURL(p.thumbUrl)
    this.previews.clear()
    this.cache.clear()
    this.photos.clear()
    this.dir = null
    this.folder = folder
    this.manualSets = load<string[][]>(this.key('edits'), [])
  }

  private key(kind: string) {
    return `pixora:${kind}:${this.folder}`
  }

  private setEntries(entries: Entry[]) {
    this.entries = new Map(entries.map((e) => [e.name, e]))
  }

  private async refreshEntries() {
    if (!this.dir) return
    const entries: Entry[] = []
    for await (const handle of (this.dir as unknown as AsyncDirectory).values())
      if (handle.kind === 'file' && !handle.name.startsWith('.')) {
        const fh = handle as FileSystemFileHandle
        entries.push({ name: fh.name, file: await fh.getFile(), handle: fh })
      }
    this.setEntries(entries)
  }

  // ------------------------------------------------------------------ analysis
  private async analyse(entry: Entry): Promise<WebPhoto | null> {
    const key = keyOf(entry.file)
    if (this.cache.has(key)) return this.cache.get(key)!
    const r = await this.pool.run(entry.file)
    let photo: WebPhoto | null = null
    if (r.ok) {
      const date = r.date ?? localIso(entry.file.lastModified)
      photo = {
        info: {
          id: entry.name,
          name: entry.name,
          size: entry.file.size,
          width: r.width,
          height: r.height,
          date,
          sharpness: r.sharpness,
          score: r.score,
          ai_quality: null,
          category: null,
          confidence: null,
          labels: [],
          overridden: false,
        },
        time: new Date(date).getTime(),
        hashes: r.hashes,
        thumbUrl: URL.createObjectURL(r.thumb),
      }
    }
    this.cache.set(key, photo)
    return photo
  }

  private async scan() {
    if (!browserSupported()) {
      this.status = 'error'
      this.error =
        'This browser cannot analyse photos (it needs Web Workers and OffscreenCanvas). Please use a current Chrome, Edge, Firefox or Safari.'
      return
    }
    const folder = this.folder
    const images = [...this.entries.values()].filter((e) => IMAGE_EXT.test(e.name))
    this.status = 'scanning'
    this.progress = 0
    this.total = images.length
    const results = await Promise.all(
      images.map((e) =>
        this.analyse(e).finally(() => {
          this.progress++
        }),
      ),
    )
    if (folder !== this.folder) return // another folder was opened meanwhile
    this.photos = new Map()
    this.skipped = []
    images.forEach((e, i) => {
      const p = results[i]
      if (p) this.photos.set(e.name, p)
      else this.skipped.push(e.name)
    })
    this.status = 'ready'
  }

  // ------------------------------------------------------------------ queries
  library(): Promise<LibraryState> {
    const entries = [...this.entries.values()]
    return Promise.resolve({
      folder: this.folder,
      status: this.status,
      progress: this.progress,
      total: this.total,
      error: this.error,
      count: this.photos.size,
      total_size: [...this.photos.values()].reduce((s, p) => s + p.info.size, 0),
      files: entries.length,
      videos: entries.filter((e) => VIDEO_EXT.test(e.name)).length,
      trash: this.dir ? `${TRASH} folder` : null,
      skipped: this.skipped.slice(0, 20),
      skipped_count: this.skipped.length,
      edition: 'web',
      can_write: !!this.dir,
      ai: {
        available: false,
        enabled: false,
        status: 'off',
        progress: 0,
        total: 0,
        error: null,
        unreadable: [],
        models: [],
        default_similarity: 0.95,
      },
    })
  }

  groups(mode: string, threshold: number): Promise<{ groups: Group[] }> {
    if (mode === 'ai') return Promise.reject(new Error(DESKTOP_ONLY))
    if (this.status !== 'ready') return Promise.reject(new Error(`Library is ${this.status}`))
    const list = [...this.photos.values()].sort((a, b) => a.time - b.time)
    const grouped = this.applyManual(groupPhotos(list, threshold, 120))
    return Promise.resolve({
      groups: grouped.map(([g, manual]) => {
        const ranked = [...g].sort((a, b) => b.info.score - a.info.score)
        let worst = 0
        for (let i = 0; i < g.length; i++)
          for (let j = i + 1; j < g.length; j++)
            worst = Math.max(worst, distance(g[i].hashes, g[j].hashes))
        return {
          photos: g.map((p) => p.info),
          best: ranked[0].info.id,
          ranked: ranked.map((p) => p.info.id),
          manual,
          cohesion:
            g.length > 1
              ? { kind: 'hash', value: Math.round((1 - worst / 256) * 1000) / 1000 }
              : null,
        }
      }),
    })
  }

  /** User edits (merge / split / exclude) are fixed sets of photo ids, like the desktop app. */
  private applyManual(grouped: WebPhoto[][]): [WebPhoto[], boolean][] {
    const byId = new Map(grouped.flat().map((p) => [p.info.id, p]))
    const manual = this.manualSets
      .map((s) => s.map((id) => byId.get(id)).filter((p): p is WebPhoto => !!p))
      .filter((m) => m.length)
      .map((m) => m.sort((a, b) => a.time - b.time))
    const taken = new Set(manual.flat().map((p) => p.info.id))
    const auto = grouped.map((g) => g.filter((p) => !taken.has(p.info.id))).filter((g) => g.length)
    const out: [WebPhoto[], boolean][] = [
      ...manual.map((m) => [m, true] as [WebPhoto[], boolean]),
      ...auto.map((g) => [g, false] as [WebPhoto[], boolean]),
    ]
    return out.sort((a, b) => b[0].length - a[0].length || a[0][0].time - b[0][0].time)
  }

  thumbUrl(id: string): string {
    return this.photos.get(id)?.thumbUrl ?? ''
  }

  previewUrl(id: string): string {
    const entry = this.entries.get(id)
    if (!entry) return ''
    if (!this.previews.has(id)) this.previews.set(id, URL.createObjectURL(entry.file))
    return this.previews.get(id)!
  }

  // ------------------------------------------------------------------ set edits
  private addManual(sets: string[][]): Promise<LibraryState> {
    const ids = new Set(sets.flat())
    this.manualSets = [
      ...this.manualSets.map((s) => s.filter((i) => !ids.has(i))).filter((s) => s.length),
      ...sets.filter((s) => s.length),
    ]
    save(this.key('edits'), this.manualSets)
    return this.library()
  }

  private known(ids: string[]) {
    return [...new Set(ids)].filter((i) => this.photos.has(i))
  }

  mergeSets(a: string[], b: string[]) {
    const ids = this.known([...a, ...b])
    if (ids.length < 2) return Promise.reject(new Error('Pick two sets to merge'))
    return this.addManual([ids])
  }

  splitSet(all: string[], selected: string[]) {
    const ids = this.known(all)
    const chosen = this.known(selected).filter((i) => ids.includes(i))
    const rest = ids.filter((i) => !chosen.includes(i))
    if (!chosen.length || !rest.length)
      return Promise.reject(
        new Error('Select some, but not all, photos of the set to split them off'),
      )
    return this.addManual([chosen, rest])
  }

  excludeFromSet(id: string) {
    if (!this.photos.has(id)) return Promise.reject(new Error('Photo not found'))
    return this.addManual([[id]])
  }

  resetSets() {
    this.manualSets = []
    save(this.key('edits'), [])
    return this.library()
  }

  // ------------------------------------------------------------------ changing files
  /** Ask for write access. Called synchronously from the Apply / Undo click (user gesture). */
  private writable(): Promise<FileSystemDirectoryHandle> {
    const dir = this.dir
    if (!dir) return Promise.reject(new Error(READ_ONLY))
    return (dir as unknown as PermissionHandle)
      .requestPermission({ mode: 'readwrite' })
      .then((p) => {
        if (p !== 'granted')
          throw new Error('Permission to change files was not given. Nothing was changed.')
        return dir
      })
  }

  private static async exists(dir: FileSystemDirectoryHandle, name: string) {
    try {
      await dir.getFileHandle(name)
      return true
    } catch {
      return false
    }
  }

  /** Copy into `to`, check the copy, then remove the original: a failure never loses the photo. */
  private static async move(
    from: FileSystemDirectoryHandle,
    to: FileSystemDirectoryHandle,
    name: string,
    newName: string,
  ) {
    const file = await (await from.getFileHandle(name)).getFile()
    const out = await to.getFileHandle(newName, { create: true })
    const w = await out.createWritable()
    await w.write(file)
    await w.close()
    if ((await out.getFile()).size !== file.size) {
      await to.removeEntry(newName)
      throw new Error('copy could not be verified; the original was kept')
    }
    await from.removeEntry(name)
  }

  private static async freeName(dir: FileSystemDirectoryHandle, name: string) {
    const dot = name.lastIndexOf('.')
    const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
    let candidate = name
    for (let n = 1; await WebEngine.exists(dir, candidate); n++) candidate = `${base} (${n})${ext}`
    return candidate
  }

  private static async rotate(dir: FileSystemDirectoryHandle, name: string, turns: number) {
    const handle = await dir.getFileHandle(name)
    const patched = patchOrientation(await (await handle.getFile()).arrayBuffer(), turns)
    if (!patched) return false
    const w = await handle.createWritable()
    await w.write(patched)
    await w.close()
    return true
  }

  private async appendLog(dir: FileSystemDirectoryHandle, rows: (string | number)[][]) {
    if (!rows.length) return
    const handle = await dir.getFileHandle(LOG_NAME, { create: true })
    const size = (await handle.getFile()).size
    const w = await handle.createWritable({ keepExistingData: true })
    await w.seek(size)
    await w.write((size ? '' : csvLine(LOG_HEADER)) + rows.map(csvLine).join(''))
    await w.close()
  }

  private async rescan() {
    await this.refreshEntries()
    await this.scan()
  }

  apply(decisions: Record<string, Decision>): Promise<ApplyResult> {
    return this.writable().then(async (dir) => {
      const results: ApplyResult['results'] = []
      const rows: (string | number)[][] = []
      const batch: Batch = { time: nowText(), undone: false, items: [] }
      let freed = 0
      for (const [id, d] of Object.entries(decisions)) {
        const entry = this.entries.get(id)
        if (!entry || !(await WebEngine.exists(dir, id))) {
          results.push({ id, ok: false, message: 'missing, skipped' })
          continue
        }
        const size = entry.file.size
        try {
          if (d.delete) {
            const trash = await dir.getDirectoryHandle(TRASH, { create: true })
            const dest = await WebEngine.freeName(trash, id)
            await WebEngine.move(dir, trash, id, dest)
            freed += size
            rows.push([batch.time, id, 'delete', `${TRASH}/${dest}`, size, 0])
            batch.items.push({ id, action: 'delete', detail: dest })
            results.push({ id, ok: true, message: `moved to ${TRASH}/` })
            continue
          }
          const msgs: string[] = []
          let ok = true
          const turns = d.rotate % 4
          if (turns) {
            if (await WebEngine.rotate(dir, id, turns)) {
              rows.push([
                batch.time,
                id,
                'rotate',
                `${turns * 90} deg cw, lossless (EXIF tag)`,
                size,
                size,
              ])
              batch.items.push({ id, action: 'rotate', detail: `${turns * 90}`, turns })
              msgs.push(`rotated ${turns * 90}° (lossless)`)
            } else {
              ok = false
              msgs.push('not rotated: no EXIF orientation tag (the desktop app can re-save it)')
            }
          }
          if (d.shrink) {
            ok = false
            msgs.push('shrink is available in the desktop app')
          }
          results.push({ id, ok, message: msgs.join('; ') || 'no change' })
        } catch (e) {
          results.push({ id, ok: false, message: `error: ${e}` })
        }
      }
      await this.appendLog(dir, rows)
      if (batch.items.length) {
        const batches = load<Batch[]>(this.key('undo'), [])
        save(this.key('undo'), [...batches, batch].slice(-20))
      }
      await this.rescan()
      return { results, freed, log: `${this.folder}/${LOG_NAME}` }
    })
  }

  // ------------------------------------------------------------------ undo
  private lastBatch(): Batch | undefined {
    return load<Batch[]>(this.key('undo'), [])
      .filter((b) => !b.undone)
      .pop()
  }

  async undoPlan(): Promise<UndoPlan> {
    const batch = this.lastBatch()
    if (!batch || !this.dir) return { batch: null, items: [] }
    const items: UndoPlan['items'] = []
    for (const item of [...batch.items].reverse()) {
      const here = await WebEngine.exists(this.dir, item.id)
      if (item.action === 'delete')
        items.push({
          id: item.id,
          action: 'delete',
          ok: !here,
          message: here ? 'a file with this name already exists' : `move back from ${TRASH}/`,
        })
      else
        items.push({
          id: item.id,
          action: 'rotate',
          ok: here,
          message: here ? `rotate back ${item.detail}° counter-clockwise` : 'file is missing',
        })
    }
    return { batch: batch.time, items }
  }

  undo(): Promise<UndoResult> {
    return this.writable().then(async (dir) => {
      const batches = load<Batch[]>(this.key('undo'), [])
      const batch = [...batches].reverse().find((b) => !b.undone)
      if (!batch) throw new Error('Nothing to undo')
      const results: UndoResult['results'] = []
      const rows: (string | number)[][] = []
      const time = nowText()
      for (const item of [...batch.items].reverse()) {
        let ok = false
        let message: string
        try {
          if (item.action === 'delete') {
            const trash = await dir.getDirectoryHandle(TRASH)
            if (await WebEngine.exists(dir, item.id))
              message = 'a file with this name already exists'
            else {
              await WebEngine.move(trash, dir, item.detail, item.id)
              ok = true
              message = `moved back from ${TRASH}/`
            }
          } else {
            ok = await WebEngine.rotate(dir, item.id, 4 - (item.turns ?? 0))
            message = ok ? 'rotated back (lossless)' : 'could not rotate back'
          }
        } catch (e) {
          message = `error: ${e}`
        }
        rows.push([time, item.id, `undo ${item.action}`, `batch ${batch.time}; ${message}`, '', ''])
        results.push({ id: item.id, ok, message })
      }
      batch.undone = true
      save(this.key('undo'), batches)
      await this.appendLog(dir, rows)
      await this.rescan()
      return { batch: batch.time, results, log: `${this.folder}/${LOG_NAME}` }
    })
  }
}

// ---- types the TypeScript DOM library does not have yet (Chromium-only APIs)
type ShowDirectoryPicker = (options?: {
  id?: string
  mode?: 'read' | 'readwrite'
}) => Promise<FileSystemDirectoryHandle>
type AsyncDirectory = { values(): AsyncIterable<FileSystemHandle> }
type PermissionHandle = {
  requestPermission(d: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}
