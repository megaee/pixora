import type { CategoryInfo, Group, PhotoInfo } from './types'

/** A card / gallery: a set of similar photos, a content category, or all photos without a close
 *  match ("Unique shots"). Built from what the backend returns; nothing here is invented. */
export interface PhotoSet {
  key: string
  title: string
  subtitle: string
  photos: PhotoInfo[]
  best: string | null
  manual?: boolean
  cohesion?: Group['cohesion']
  /** most common content category among the photos (null when not classified) */
  category?: string | null
}

export type SetSort = 'count' | 'newest' | 'oldest'

const when = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(
    [],
    { hour: 'numeric', minute: '2-digit' },
  )}`
}

/** Most common confident category of a set's photos ("other" never names a set). */
function dominant(photos: PhotoInfo[]): string | null {
  const counts = new Map<string, number>()
  for (const p of photos)
    if (p.category && p.category !== 'other')
      counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  let best: string | null = null
  for (const [c, n] of counts) if (!best || n > counts.get(best)!) best = c
  return best
}

export function toSets(groups: Group[], labels: Record<string, string>): PhotoSet[] {
  const sets: PhotoSet[] = groups
    .filter((g) => g.photos.length > 1)
    .map((g) => {
      const category = dominant(g.photos)
      return {
        key: `set:${g.photos[0].id}`,
        title: category ? (labels[category] ?? category) : 'Similar shots',
        subtitle: when(g.photos[0].date),
        photos: g.photos,
        best: g.best,
        manual: g.manual,
        cohesion: g.cohesion,
        category,
      }
    })
  const singles = groups
    .filter((g) => g.photos.length === 1)
    .map((g) => g.photos[0])
    .sort((a, b) => a.date.localeCompare(b.date))
  if (singles.length)
    sets.push({
      key: 'unique',
      title: 'Unique shots',
      subtitle: 'no close match',
      photos: singles,
      best: null,
    })
  return sets
}

/** Content categories as cards, in the fixed category order, empty ones left out. */
export function categoryCards(
  categories: CategoryInfo[],
  byId: Map<string, PhotoInfo>,
): PhotoSet[] {
  return categories
    .filter((c) => c.count > 0)
    .map((c) => ({
      key: `cat:${c.id}`,
      title: c.label,
      subtitle: `${c.count - c.secondary.length} mainly, ${c.secondary.length} also`,
      photos: c.photos.map((id) => byId.get(id)).filter((p): p is PhotoInfo => !!p),
      best: null,
      category: c.id,
    }))
}

const newest = (s: PhotoSet) => s.photos.reduce((m, p) => (p.date > m ? p.date : m), '')

/** Search (set name, category, file names), category filter and sort for the Similar sets view. */
export function filterSets(
  sets: PhotoSet[],
  { query, category, sort }: { query: string; category: string; sort: SetSort },
  labels: Record<string, string>,
): PhotoSet[] {
  const q = query.trim().toLowerCase()
  const out = sets.filter((s) => {
    if (category && !s.photos.some((p) => p.category === category)) return false
    if (!q) return true
    const text = [s.title, s.subtitle, ...s.photos.map((p) => p.name)]
    for (const p of s.photos) if (p.category) text.push(labels[p.category] ?? p.category)
    return text.some((t) => t.toLowerCase().includes(q))
  })
  if (sort === 'count') out.sort((a, b) => b.photos.length - a.photos.length)
  else if (sort === 'newest') out.sort((a, b) => newest(b).localeCompare(newest(a)))
  else out.sort((a, b) => newest(a).localeCompare(newest(b)))
  return out
}
