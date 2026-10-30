export interface PhotoInfo {
  id: string
  name: string
  size: number
  width: number
  height: number
  date: string
  sharpness: number
  score: number
  /** 0..1 from the AI quality model, null until AI mode has analysed this photo */
  ai_quality: number | null
  /** content category id (null until classified), its score, extra labels, user correction */
  category: string | null
  confidence: number | null
  labels: { id: string; score: number }[]
  overridden: boolean
}

/** One content category with its photos (primary first, then photos where it is an extra label) */
export interface CategoryInfo {
  id: string
  label: string
  count: number
  photos: string[]
  secondary: string[]
}

export type GroupMode = 'classic' | 'ai'

export interface AIState {
  available: boolean
  enabled: boolean
  status: 'off' | 'loading' | 'running' | 'ready' | 'cancelled' | 'error'
  progress: number
  total: number
  error: string | null
  unreadable: string[]
  models: string[]
  default_similarity: number
}

export interface Group {
  photos: PhotoInfo[]
  best: string
  ranked: string[]
  /** made or changed by the user (merge / split / exclude) */
  manual: boolean
  /** how alike the least similar pair is, 0..1 (null for a single photo) */
  cohesion: { kind: 'ai' | 'hash'; value: number } | null
}

export interface LibraryState {
  folder: string | null
  status: 'idle' | 'scanning' | 'ready' | 'error'
  progress: number
  total: number
  error: string | null
  count: number
  total_size: number
  /** every visible file in the folder, and how many of them are videos (counted, never changed) */
  files: number
  videos: number
  /** image files that could not be read (corrupt or unsupported) */
  skipped: string[]
  skipped_count: number
  /** 'web' = browser edition (folder picked in the browser); absent = desktop app */
  edition?: 'desktop' | 'web'
  /** web edition: false when the browser can only read the folder */
  can_write?: boolean
  trash: string | null
  ai: AIState
}

/** What the user decided for one photo. rotate = clockwise quarter turns (0-3). */
export interface Decision {
  delete: boolean
  rotate: number
  shrink: boolean
}

export interface ShrinkOptions {
  max_side: number
  quality: number
}

export interface ApplyResult {
  results: { id: string; ok: boolean; message: string }[]
  freed: number
  log: string
}

/** What "Undo last apply" would do. batch = timestamp of that apply, null if nothing to undo. */
export interface UndoPlan {
  batch: string | null
  items: { id: string; action: 'delete' | 'rotate' | 'shrink'; ok: boolean; message: string }[]
}

export interface UndoResult {
  batch: string
  results: { id: string; ok: boolean; message: string }[]
  log: string
}

export interface DirEntry {
  name: string
  path: string
  /** photos directly inside; null = no permission to read */
  photos: number | null
}

export interface DirListing {
  path: string
  parent: string | null
  photos: number | null
  dirs: DirEntry[]
  truncated: boolean
  places: { name: string; path: string }[]
}
