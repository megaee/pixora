import type { PhotoInfo } from './types'

const MAX_ITEMS = 180
const RADIUS = 37 // largest disc radius, in % of the (square) pile box
const CENTER_Y = 44 // leaves room below for the folder tray
const COVER = 1.8 // total print area / disc area: >1 means prints overlap

export interface PileItem {
  photo: PhotoInfo
  /** position and side of the square print, in % of the pile box */
  left: number
  top: number
  size: number
  rotate: number
  z: number
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Small seeded PRNG (mulberry32) so the same photos always land in the same places. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** Heap the photos into a round, overlapping blob (sunflower spiral with jitter). Prints are
 *  sized from the count so the disc is always well covered: a few big squares for a small folder,
 *  many small ones for a big folder. */
export function layoutPile(photos: PhotoInfo[], shuffle = 0): PileItem[] {
  const picked = [...photos]
    .sort((a, b) => hash(a.id + shuffle) - hash(b.id + shuffle))
    .slice(0, MAX_ITEMS)
  const n = picked.length
  if (!n) return []
  const rand = rng(hash(picked.map((p) => p.id).join('|')) + shuffle * 7919)
  const golden = Math.PI * (3 - Math.sqrt(5))
  // small tiles even for small folders; a small folder makes a smaller (still dense) disc
  const base = clamp(RADIUS * Math.sqrt((COVER * Math.PI) / n), 6, 15.5)
  const radius = Math.min(RADIUS, base * Math.sqrt(n / (COVER * Math.PI)) + base * 0.4)
  return picked.map((photo, i) => {
    const size = base * (0.82 + rand() * 0.36)
    const stray = rand() < 0.05 ? 1.14 : 1
    const r = (radius - base * 0.35) * Math.sqrt((i + 0.5) / n) * stray
    const angle = i * golden + (rand() - 0.5) * 0.5
    const cx = 50 + Math.cos(angle) * r + (rand() - 0.5) * base * 0.3
    const cy = CENTER_Y + Math.sin(angle) * r + (rand() - 0.5) * base * 0.3
    return {
      photo,
      size,
      left: clamp(cx - size / 2, 0.5, 99.5 - size),
      top: clamp(cy - size / 2, 0.5, 99.5 - size),
      rotate: (rand() - 0.5) * 16,
      z: 1 + Math.floor(rand() * 100),
    }
  })
}
