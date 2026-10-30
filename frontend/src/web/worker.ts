/** Decodes one photo off the main thread: metadata, thumbnail, hashes and quality score.
 *  Everything stays in this browser tab; nothing is sent anywhere. */
import { dhash, HASH_SIZE, qualityScores, toGray } from './analysis'
import { readImageMeta } from './exif'

export interface WorkerRequest {
  id: string
  file: File
}

export type WorkerResponse =
  | {
      id: string
      ok: true
      width: number
      height: number
      date: string | null
      sharpness: number
      score: number
      hashes: Uint32Array[]
      thumb: Blob
    }
  | { id: string; ok: false; error: string }

const ANALYSIS_SIZE = 512
const THUMB_SIZE = 420

function fit(w: number, h: number, max: number): [number, number] {
  const s = Math.min(1, max / Math.max(w, h))
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))]
}

function context(w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  return { canvas, ctx }
}

/** Hash of the image turned by 0/90/180/270 degrees, squeezed to (size+1) x size like Pillow. */
function rotationHashes(src: OffscreenCanvas): Uint32Array[] {
  return [0, 90, 180, 270].map((angle) => {
    const { ctx } = context(HASH_SIZE + 1, HASH_SIZE)
    const sideways = angle % 180 !== 0
    const dw = sideways ? HASH_SIZE : HASH_SIZE + 1
    const dh = sideways ? HASH_SIZE + 1 : HASH_SIZE
    ctx.translate((HASH_SIZE + 1) / 2, HASH_SIZE / 2)
    ctx.rotate((-angle * Math.PI) / 180)
    ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh)
    const px = ctx.getImageData(0, 0, HASH_SIZE + 1, HASH_SIZE).data
    return dhash(toGray(px))
  })
}

// typed by hand: this file is compiled with the DOM library, not the worker one
const scope = self as unknown as {
  onmessage: (event: MessageEvent<WorkerRequest>) => void
  postMessage: (message: WorkerResponse) => void
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, file } = event.data
  try {
    const meta = readImageMeta(await file.slice(0, 256 * 1024).arrayBuffer())
    const bitmap = await createImageBitmap(file) // EXIF orientation applied by the browser
    const [w, h] = fit(bitmap.width, bitmap.height, ANALYSIS_SIZE)
    const small = context(w, h)
    small.ctx.drawImage(bitmap, 0, 0, w, h)
    const [tw, th] = fit(bitmap.width, bitmap.height, THUMB_SIZE)
    const thumb = context(tw, th)
    thumb.ctx.drawImage(bitmap, 0, 0, tw, th)
    const width = bitmap.width
    const height = bitmap.height
    bitmap.close()
    const gray = toGray(small.ctx.getImageData(0, 0, w, h).data)
    const [sharpness, score] = qualityScores(gray, w, h)
    const response: WorkerResponse = {
      id,
      ok: true,
      width: meta?.width || width,
      height: meta?.height || height,
      date: meta?.date ?? null,
      sharpness,
      score,
      hashes: rotationHashes(small.canvas),
      thumb: await thumb.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }),
    }
    scope.postMessage(response)
  } catch (e) {
    scope.postMessage({ id, ok: false, error: String(e) })
  }
}
