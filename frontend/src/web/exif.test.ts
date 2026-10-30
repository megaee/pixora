import { describe, expect, it } from 'vitest'
import { patchOrientation, readImageMeta, rotatedOrientation } from './exif'

/** A minimal JPEG header: APP1/Exif (little endian) with orientation + DateTimeOriginal, SOF0. */
function fakeJpeg(orientation: number, width = 600, height = 400): ArrayBuffer {
  const date = '2024:09:22 09:40:29\0'
  const tiff: number[] = []
  const u16 = (v: number) => tiff.push(v & 0xff, v >> 8)
  const u32 = (v: number) => tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24)
  tiff.push(0x49, 0x49) // "II"
  u16(42)
  u32(8) // IFD0 at 8
  u16(2) // two entries
  // orientation (SHORT, inline value)
  u16(0x0112)
  u16(3)
  u32(1)
  u16(orientation)
  u16(0)
  // pointer to the Exif IFD at offset 38
  u16(0x8769)
  u16(4)
  u32(1)
  u32(38)
  u32(0) // no next IFD
  u16(1) // Exif IFD: one entry, DateTimeOriginal (ASCII, 20 bytes at offset 56)
  u16(0x9003)
  u16(2)
  u32(20)
  u32(56)
  u32(0)
  for (const ch of date) tiff.push(ch.charCodeAt(0))
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff] // "Exif\0\0" + TIFF
  const bytes = [
    0xff,
    0xd8,
    0xff,
    0xe1,
    (app1.length + 2) >> 8,
    (app1.length + 2) & 0xff,
    ...app1,
    0xff,
    0xc0,
    0,
    11,
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    1,
    1,
    0x11,
    0,
    0xff,
    0xda,
    0,
    2,
  ]
  return new Uint8Array(bytes).buffer
}

describe('readImageMeta', () => {
  it('reads size, orientation and capture date from a JPEG', () => {
    const meta = readImageMeta(fakeJpeg(1))!
    expect([meta.width, meta.height, meta.orientation]).toEqual([600, 400, 1])
    expect(meta.date).toBe('2024-09-22T09:40:29')
    expect(meta.orientationOffset).not.toBeNull()
  })

  it('swaps width and height for photos stored sideways', () => {
    const meta = readImageMeta(fakeJpeg(6))!
    expect([meta.width, meta.height]).toEqual([400, 600])
  })

  it('reads PNG size and rejects other data', () => {
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47])
    new DataView(png.buffer).setUint32(16, 1170)
    new DataView(png.buffer).setUint32(20, 2532)
    expect(readImageMeta(png.buffer)).toMatchObject({ width: 1170, height: 2532 })
    expect(readImageMeta(new TextEncoder().encode('not an image').buffer as ArrayBuffer)).toBeNull()
  })
})

describe('lossless rotation', () => {
  it('cycles orientation values clockwise', () => {
    expect(rotatedOrientation(1, 1)).toBe(6)
    expect(rotatedOrientation(1, 2)).toBe(3)
    expect(rotatedOrientation(1, 3)).toBe(8)
    expect(rotatedOrientation(6, 4)).toBe(6)
    expect(rotatedOrientation(0, 1)).toBe(6) // invalid value treated as upright
  })

  it('changes only the orientation value', () => {
    const before = new Uint8Array(fakeJpeg(1))
    const after = new Uint8Array(patchOrientation(before.buffer, 1)!)
    expect(after.length).toBe(before.length)
    expect(after.filter((b, i) => b !== before[i]).length).toBe(1)
    expect(readImageMeta(after.buffer)!.orientation).toBe(6)
    expect(new Uint8Array(patchOrientation(after.buffer, 3)!)).toEqual(before) // and back
  })

  it('refuses files without an orientation tag', () => {
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47])
    expect(patchOrientation(png.buffer, 1)).toBeNull()
  })
})
