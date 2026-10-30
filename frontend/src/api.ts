import type {
  ApplyResult,
  CategoryInfo,
  Decision,
  DirListing,
  Group,
  GroupMode,
  LibraryState,
  ShrinkOptions,
  UndoPlan,
  UndoResult,
} from './types'
import { DESKTOP_ONLY, WebEngine } from './web/engine'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      detail = (await res.json()).detail ?? detail
    } catch {
      /* not JSON */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  return res.json() as Promise<T>
}

const serverApi = {
  library: () => request<LibraryState>('/api/library'),
  openFolder: (folder: string) =>
    request<LibraryState>('/api/library', { method: 'POST', body: JSON.stringify({ folder }) }),
  /** value = hash threshold (classic) or minimum similarity in % (ai) */
  groups: (mode: GroupMode, value: number) =>
    request<{ groups: Group[] }>(
      mode === 'ai'
        ? `/api/groups?mode=ai&similarity=${value / 100}`
        : `/api/groups?threshold=${value}`,
    ),
  enableAI: () => request<LibraryState>('/api/ai', { method: 'POST' }),
  cancelAI: () => request<LibraryState>('/api/ai/cancel', { method: 'POST' }),
  rerunAI: () => request<LibraryState>('/api/ai/rerun', { method: 'POST' }),
  categories: () => request<{ categories: CategoryInfo[] }>('/api/categories'),
  setCategory: (id: string, category: string | null) =>
    request<LibraryState>(`/api/photos/${encodeURIComponent(id)}/category`, {
      method: 'PUT',
      body: JSON.stringify({ category }),
    }),
  mergeSets: (a: string[], b: string[]) =>
    request<LibraryState>('/api/sets/merge', { method: 'POST', body: JSON.stringify({ a, b }) }),
  splitSet: (ids: string[], selected: string[]) =>
    request<LibraryState>('/api/sets/split', {
      method: 'POST',
      body: JSON.stringify({ ids, selected }),
    }),
  excludeFromSet: (id: string) =>
    request<LibraryState>('/api/sets/exclude', { method: 'POST', body: JSON.stringify({ id }) }),
  resetSets: () => request<LibraryState>('/api/sets/reset', { method: 'POST' }),
  apply: (decisions: Record<string, Decision>, shrink: ShrinkOptions) =>
    request<ApplyResult>('/api/apply', {
      method: 'POST',
      body: JSON.stringify({
        actions: Object.entries(decisions).map(([id, d]) => ({ id, ...d })),
        shrink,
      }),
    }),
  dirs: (path?: string) =>
    request<DirListing>('/api/dirs' + (path ? `?path=${encodeURIComponent(path)}` : '')),
  undoPlan: () => request<UndoPlan>('/api/undo'),
  undo: () => request<UndoResult>('/api/undo', { method: 'POST' }),
  thumbUrl: (id: string, v = 0) => `/api/photos/${encodeURIComponent(id)}/thumb?v=${v}`,
  previewUrl: (id: string, v = 0) => `/api/photos/${encodeURIComponent(id)}/preview?v=${v}`,
  /** web edition only: open the browser's folder picker (must run inside a click) */
  pickFolder: undefined as undefined | (() => Promise<LibraryState>),
}

/** `vite build --mode web` makes the browser-only edition (GitHub Pages): no server at all. */
export const isWeb = import.meta.env.MODE === 'web'
/** fired when a folder was opened outside the UI (test hook) */
export const LIBRARY_CHANGED = 'pixora:library'

function webApi(): typeof serverApi {
  const engine = new WebEngine()
  const desktopOnly = () => Promise.reject(new Error(DESKTOP_ONLY))
  // test hook: open a directory handle the page already has (e.g. the private origin file
  // system) without the native picker; it grants nothing a page script could not do itself
  ;(window as unknown as { __pixoraOpenDirectory?: unknown }).__pixoraOpenDirectory = (
    dir: FileSystemDirectoryHandle,
  ) =>
    engine.openDirectory(dir).then((s) => {
      window.dispatchEvent(new Event(LIBRARY_CHANGED))
      return s
    })
  return {
    library: () => engine.library(),
    openFolder: desktopOnly,
    groups: (mode, value) => engine.groups(mode, value),
    enableAI: desktopOnly,
    cancelAI: desktopOnly,
    rerunAI: desktopOnly,
    categories: desktopOnly,
    setCategory: desktopOnly,
    mergeSets: (a, b) => engine.mergeSets(a, b),
    splitSet: (ids, selected) => engine.splitSet(ids, selected),
    excludeFromSet: (id) => engine.excludeFromSet(id),
    resetSets: () => engine.resetSets(),
    apply: (decisions) => engine.apply(decisions),
    dirs: desktopOnly,
    undoPlan: () => engine.undoPlan(),
    undo: () => engine.undo(),
    thumbUrl: (id) => engine.thumbUrl(id),
    previewUrl: (id) => engine.previewUrl(id),
    pickFolder: () => engine.pickFolder(),
  }
}

export const api = isWeb ? webApi() : serverApi

export const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`
