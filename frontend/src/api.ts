import type { ApplyResult, Decision, Group, LibraryState, ShrinkOptions } from './types'

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

export const api = {
  library: () => request<LibraryState>('/api/library'),
  openFolder: (folder: string) =>
    request<LibraryState>('/api/library', { method: 'POST', body: JSON.stringify({ folder }) }),
  groups: (threshold: number) =>
    request<{ threshold: number; groups: Group[] }>(`/api/groups?threshold=${threshold}`),
  apply: (decisions: Record<string, Decision>, shrink: ShrinkOptions) =>
    request<ApplyResult>('/api/apply', {
      method: 'POST',
      body: JSON.stringify({
        actions: Object.entries(decisions).map(([id, d]) => ({ id, ...d })),
        shrink,
      }),
    }),
  thumbUrl: (id: string, v = 0) => `/api/photos/${encodeURIComponent(id)}/thumb?v=${v}`,
  previewUrl: (id: string, v = 0) => `/api/photos/${encodeURIComponent(id)}/preview?v=${v}`,
}

export const mb = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`
