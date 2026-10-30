import { describe, expect, it } from 'vitest'
import { dhash, distance, groupPhotos, hamming, HASH_SIZE, qualityScores, toGray } from './analysis'

const gray = (fn: (x: number, y: number) => number, w = HASH_SIZE + 1, h = HASH_SIZE) =>
  Uint8Array.from({ length: w * h }, (_, i) => fn(i % w, Math.floor(i / w)))

describe('dhash', () => {
  it('sets a bit wherever a pixel is brighter than its right neighbour', () => {
    expect([...dhash(gray((x) => 255 - x * 10))]).toEqual(Array(8).fill(0xffffffff))
    expect([...dhash(gray((x) => x * 10))]).toEqual(Array(8).fill(0))
  })

  it('measures distance in bits, taking the closest rotation', () => {
    const a = dhash(gray((x) => 255 - x * 10))
    const b = dhash(gray((x) => x * 10))
    expect(hamming(a, b)).toBe(256)
    expect(hamming(a, a)).toBe(0)
    expect(distance([a, b, b, b], [b, a, b, b])).toBe(0) // b's second rotation matches a
  })

  it('converts RGBA to luma like Pillow', () => {
    expect([...toGray(new Uint8ClampedArray([255, 255, 255, 255, 255, 0, 0, 255]))]).toEqual([
      255, 76,
    ])
  })
})

describe('qualityScores', () => {
  it('scores a detailed image above a flat one', () => {
    const flat = gray(() => 120, 32, 32)
    const detailed = gray((x, y) => ((x + y) % 2 ? 40 : 200), 32, 32)
    expect(qualityScores(flat, 32, 32)[0]).toBe(0)
    expect(qualityScores(detailed, 32, 32)[1]).toBeGreaterThan(qualityScores(flat, 32, 32)[1])
  })
})

describe('groupPhotos', () => {
  const h = (bits: number) => {
    const a = new Uint32Array(8)
    a[0] = bits
    return [a, a, a, a]
  }
  const photo = (id: string, bits: number, time: number) => ({ id, time, hashes: h(bits) })

  it('groups photos within the threshold and keeps others apart', () => {
    const groups = groupPhotos(
      [photo('a', 0, 0), photo('b', 0b111, 1e6), photo('c', 0xffffffff, 2e6)],
      5,
      0,
    )
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([['a', 'b'], ['c']])
  })

  it('allows burst shots a little more difference', () => {
    const a = photo('a', 0, 0)
    const b = photo('b', 0b1111111, 30_000) // 7 bits apart, 30 s later
    expect(groupPhotos([a, b], 6, 0)).toHaveLength(2)
    expect(groupPhotos([a, b], 6, 120)).toHaveLength(1) // 7 <= 6 * 1.3 within the window
  })
})
