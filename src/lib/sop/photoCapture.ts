// SOP fotoğrafı için kamera çekimi (kullanıcı 2026-10-31). Saf geometri: kaynak
// kare boyutundan 4:3 yatay çıktı. Dik tutulan telefonda (h > w) kare 90° döner,
// sonra 4:3'e ortadan kırpılır. Canvas çizimi ayrı, küçük bir fonksiyon.

/** Kamera isteği: arka kamera, 4:3 yatay, 1600 × 1200 ideal. Kullanıcıdan ayar istenmez. */
export const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  aspectRatio: { ideal: 4 / 3 },
  width: { ideal: 1600 },
  height: { ideal: 1200 },
}

export const OUTPUT_RATIO = 4 / 3

export interface CaptureGeometry {
  /** Kare 90° döndürülecek mi (dik çekim). */
  rotate: boolean
  /** Çıktı boyutu (px). */
  outW: number
  outH: number
  /** Döndürülmüş kare içinde kırpma ofseti (px). */
  offX: number
  offY: number
}

export function captureGeometry(srcW: number, srcH: number): CaptureGeometry {
  const rotate = srcH > srcW
  const effW = rotate ? srcH : srcW
  const effH = rotate ? srcW : srcH
  let outW = effW
  let outH = effH
  if (effW / effH > OUTPUT_RATIO) outW = Math.round(effH * OUTPUT_RATIO)
  else outH = Math.round(effW / OUTPUT_RATIO)
  return { rotate, outW, outH, offX: Math.round((effW - outW) / 2), offY: Math.round((effH - outH) / 2) }
}

/** Kaynaktan çıktı canvas'ı. Döndürmede: (x, y) → (srcH − y, x), sonra ofset. */
export function drawCapture(source: CanvasImageSource, srcW: number, srcH: number, g: CaptureGeometry): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = g.outW
  canvas.height = g.outH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available')
  ctx.setTransform(1, 0, 0, 1, -g.offX, -g.offY)
  if (g.rotate) {
    ctx.translate(srcH, 0)
    ctx.rotate(Math.PI / 2)
  }
  ctx.drawImage(source, 0, 0, srcW, srcH)
  return canvas
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Photo could not be encoded'))), 'image/jpeg', quality),
  )
}
