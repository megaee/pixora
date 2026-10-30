/** Pure image analysis for the web edition, ported from backend/src/photo_cleanup/analysis.py:
 *  rotation-invariant 256-bit difference hash, sharpness/exposure score, grouping. */

export const HASH_SIZE = 16 // 16x16 = 256 bits, stored as 8 x uint32

/** Grayscale (ITU-R 601 luma, like Pillow's "L") from RGBA pixels. */
export function toGray(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4)
  for (let i = 0, j = 0; j < out.length; i += 4, j++)
    out[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114 + 500) / 1000
  return out
}

/** Difference hash of a (size+1) x size grayscale image: each pixel vs its right neighbour. */
export function dhash(gray: Uint8Array, size = HASH_SIZE): Uint32Array {
  const bits = new Uint32Array((size * size) / 32)
  let n = 0
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++, n++) {
      const row = r * (size + 1)
      if (gray[row + c] > gray[row + c + 1]) bits[n >> 5] |= 1 << (31 - (n & 31))
    }
  return bits
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

export function hamming(a: Uint32Array, b: Uint32Array): number {
  let d = 0
  for (let i = 0; i < a.length; i++) d += popcount((a[i] ^ b[i]) >>> 0)
  return d
}

/** Smallest distance between a's upright hash and any rotation of b (0..256). */
export const distance = (a: Uint32Array[], b: Uint32Array[]) =>
  Math.min(...b.map((h) => hamming(a[0], h)))

/** (sharpness, score): variance of a 3x3 edge filter, penalised for clipped highlights/shadows
 *  and poor overall exposure. Same formula as the desktop app. */
export function qualityScores(gray: Uint8Array, w: number, h: number): [number, number] {
  let sum = 0
  let sumSq = 0
  let count = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const i = y * w + x
        v =
          8 * gray[i] -
          gray[i - w - 1] -
          gray[i - w] -
          gray[i - w + 1] -
          gray[i - 1] -
          gray[i + 1] -
          gray[i + w - 1] -
          gray[i + w] -
          gray[i + w + 1]
        v = Math.max(0, Math.min(255, v))
      }
      sum += v
      sumSq += v * v
      count++
    }
  const mean = sum / count
  const sharp = sumSq / count - mean * mean
  let clipped = 0
  let total = 0
  for (const v of gray) {
    if (v < 5 || v > 250) clipped++
    total += v
  }
  const clippedShare = clipped / gray.length
  const exposurePen = Math.abs(total / gray.length - 120) / 120
  const score =
    sharp * (1 - Math.min(clippedShare * 3, 0.6)) * (1 - Math.min(exposurePen * 0.5, 0.4))
  return [Math.round(sharp * 10) / 10, Math.round(score * 10) / 10]
}

export interface Hashable {
  /** capture time in ms */
  time: number
  hashes: Uint32Array[]
}

/** Union-find grouping: linked when distance <= threshold, or within timeWindow seconds and
 *  distance <= threshold * 1.3 (burst shots may differ a bit more). */
export function groupPhotos<T extends Hashable>(
  photos: T[],
  threshold = 22,
  timeWindow = 120,
): T[][] {
  const parent = photos.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]]
    return i
  }
  for (let i = 0; i < photos.length; i++)
    for (let j = i + 1; j < photos.length; j++) {
      const d = distance(photos[i].hashes, photos[j].hashes)
      const close = Math.abs(photos[i].time - photos[j].time) <= timeWindow * 1000
      if (d <= threshold || (close && d <= threshold * 1.3)) parent[find(i)] = find(j)
    }
  const buckets = new Map<number, T[]>()
  photos.forEach((p, i) => {
    const root = find(i)
    buckets.set(root, [...(buckets.get(root) ?? []), p])
  })
  const groups = [...buckets.values()].map((g) => g.sort((a, b) => a.time - b.time))
  return groups.sort((a, b) => b.length - a.length || a[0].time - b[0].time)
}
