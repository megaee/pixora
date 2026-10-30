import type { Decision, Group, PhotoInfo } from './types'

export type Decisions = Record<string, Decision>

/** In every group with 2+ photos keep the `keep` best-scored ones and mark the rest for deletion.
 *  Rotate/shrink choices already made are preserved. */
export function autoSelect(groups: Group[], keep: number, prev: Decisions = {}): Decisions {
  const next: Decisions = {}
  for (const g of groups) {
    const keepIds = new Set(g.photos.length > 1 ? g.ranked.slice(0, keep) : g.ranked)
    for (const p of g.photos) {
      const old = prev[p.id]
      next[p.id] = {
        delete: !keepIds.has(p.id),
        rotate: old?.rotate ?? 0,
        shrink: old?.shrink ?? false,
      }
    }
  }
  return next
}

export const isChanged = (d?: Decision) => !!d && (d.delete || d.rotate !== 0 || d.shrink)

export function describe(d: Decision): string[] {
  if (d.delete) return ['move to trash']
  const out: string[] = []
  if (d.rotate)
    out.push(
      d.rotate === 1 ? 'rotate 90° right' : d.rotate === 3 ? 'rotate 90° left' : 'rotate 180°',
    )
  if (d.shrink) out.push('shrink')
  return out
}

/** Rough storage estimate: deleted photos free their full size, shrinking frees ~60 %. */
export function summarise(photos: PhotoInfo[], decisions: Decisions) {
  let deleted = 0
  let edited = 0
  let freed = 0
  for (const p of photos) {
    const d = decisions[p.id]
    if (!d) continue
    if (d.delete) {
      deleted++
      freed += p.size
    } else if (d.rotate || d.shrink) {
      edited++
      if (d.shrink) freed += p.size * 0.6
    }
  }
  return { deleted, edited, freed }
}
