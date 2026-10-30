/** Minimal JPEG / PNG header reading for the web edition: size, capture date and the EXIF
 *  orientation tag (with its byte offset, so a rotation can be done by patching one value). */

export interface ImageMeta {
  /** as displayed, i.e. width/height swapped for photos stored sideways */
  width: number
  height: number
  orientation: number
  /** byte offset of the orientation value, null when the file has no orientation tag */
  orientationOffset: number | null
  littleEndian: boolean
  /** "YYYY-MM-DDTHH:MM:SS" (local time) from EXIF, null when absent */
  date: string | null
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function ascii(view: DataView, start: number, length: number): string {
  let s = ''
  for (let i = 0; i < length && start + i < view.byteLength; i++) {
    const c = view.getUint8(start + i)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s
}

const exifDate = (s: string) =>
  /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d/.test(s)
    ? `${s.slice(0, 4)}-${s.slice(5, 7)}-${s.slice(8, 10)}T${s.slice(11, 19)}`
    : null

function readTiff(view: DataView, tiff: number, meta: ImageMeta) {
  const little = view.getUint16(tiff) === 0x4949
  meta.littleEndian = little
  const u16 = (o: number) => view.getUint16(o, little)
  const u32 = (o: number) => view.getUint32(o, little)
  let dateTime: string | null = null
  let original: string | null = null
  const readIfd = (ifd: number, depth: number) => {
    if (ifd + 2 > view.byteLength || depth > 1) return
    const count = u16(ifd)
    for (let k = 0; k < count; k++) {
      const e = ifd + 2 + k * 12
      if (e + 12 > view.byteLength) return
      const tag = u16(e)
      const type = u16(e + 2)
      if (tag === 0x0112 && type === 3) {
        meta.orientation = u16(e + 8)
        meta.orientationOffset = e + 8
      } else if (tag === 0x8769) {
        readIfd(tiff + u32(e + 8), depth + 1)
      } else if ((tag === 0x0132 || tag === 0x9003) && type === 2) {
        const value = ascii(view, tiff + u32(e + 8), 19)
        if (tag === 0x9003) original = value
        else dateTime = value
      }
    }
  }
  readIfd(tiff + u32(tiff + 4), 0)
  meta.date = exifDate(original ?? dateTime ?? '')
}

/** Parse the start of an image file (256 KB is enough for JPEG/PNG headers). */
export function readImageMeta(buffer: ArrayBuffer): ImageMeta | null {
  const view = new DataView(buffer)
  const meta: ImageMeta = {
    width: 0,
    height: 0,
    orientation: 1,
    orientationOffset: null,
    littleEndian: false,
    date: null,
  }
  if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47) {
    meta.width = view.getUint32(16)
    meta.height = view.getUint32(20)
    return meta
  }
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null
  let pos = 2
  try {
    while (pos + 4 <= view.byteLength) {
      if (view.getUint8(pos) !== 0xff) break
      const marker = view.getUint8(pos + 1)
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        pos += 2
        continue
      }
      const length = view.getUint16(pos + 2)
      if (marker === 0xe1 && ascii(view, pos + 4, 4) === 'Exif') readTiff(view, pos + 10, meta)
      else if (SOF.has(marker)) {
        meta.height = view.getUint16(pos + 5)
        meta.width = view.getUint16(pos + 7)
        break
      }
      if (marker === 0xda) break
      pos += 2 + length
    }
  } catch {
    /* truncated header: keep what was read */
  }
  if (meta.orientation >= 5 && meta.orientation <= 8)
    [meta.width, meta.height] = [meta.height, meta.width]
  return meta
}

/** EXIF orientation after one clockwise quarter turn, for each current value. */
const CW: Record<number, number> = { 1: 6, 6: 3, 3: 8, 8: 1, 2: 7, 7: 4, 4: 5, 5: 2 }

export function rotatedOrientation(current: number, quarterTurnsCw: number): number {
  let v = CW[current] ? current : 1
  for (let i = 0; i < ((quarterTurnsCw % 4) + 4) % 4; i++) v = CW[v]
  return v
}

/** Lossless rotation: a copy of the file with only the orientation value changed,
 *  or null when the file has no orientation tag (then it cannot be rotated losslessly). */
export function patchOrientation(file: ArrayBuffer, quarterTurnsCw: number): ArrayBuffer | null {
  const meta = readImageMeta(file.slice(0, 256 * 1024))
  if (!meta || meta.orientationOffset === null) return null
  const out = file.slice(0)
  new DataView(out).setUint16(
    meta.orientationOffset,
    rotatedOrientation(meta.orientation, quarterTurnsCw),
    meta.littleEndian,
  )
  return out
}
