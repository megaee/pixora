const RECENT_KEY = 'photo-cleanup:recent-folders'

/** Recently opened folders, newest first. Per-browser convenience only. */
export function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function rememberFolder(folder: string) {
  try {
    const next = [folder, ...loadRecent().filter((f) => f !== folder)].slice(0, 6)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable */
  }
}
