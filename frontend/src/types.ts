export interface PhotoInfo {
  id: string
  name: string
  size: number
  width: number
  height: number
  date: string
  sharpness: number
  score: number
}

export interface Group {
  photos: PhotoInfo[]
  best: string
  ranked: string[]
}

export interface LibraryState {
  folder: string | null
  status: 'idle' | 'scanning' | 'ready' | 'error'
  progress: number
  total: number
  error: string | null
  count: number
  total_size: number
  trash: string | null
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
