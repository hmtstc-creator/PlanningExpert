// Yüklemeden önce fotoğrafı küçültme.
//
// Telefon kamerası 3–5 MB'lık kareler üretiyor. Bir kalıp problemini
// belgelemek için gereken çözünürlük bunun çok altında: çapağın nerede
// olduğu 1600 pikselde de görünür. Küçültmeden yüklemek depoyu on kat
// hızlı doldurur ve sahadaki telefonun mobil verisini yer.

/** Uzun kenarın üst sınırı. Bir kusuru göstermeye fazlasıyla yeter. */
export const MAX_DIMENSION = 1600
/** JPEG kalitesi. 0.8 gözle farkı belli olmayan, dosyayı yarıya indiren yer. */
export const JPEG_QUALITY = 0.8

/**
 * En-boy oranını koruyarak sığdırılmış ölçü.
 *
 * Küçük resim BÜYÜTÜLMEZ: 800 pikseli 1600'e çıkarmak dosyayı şişirir,
 * yeni bir ayrıntı katmaz.
 */
export function fittedSize(
  width: number,
  height: number,
  max = MAX_DIMENSION,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  const longest = Math.max(width, height)
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Fotoğrafı küçültülmüş bir JPEG'e çevirir.
 *
 * Herhangi bir adımda başarısız olursa DOSYANIN KENDİSİ döner: küçültme bir
 * kolaylık, kayıt ise asıl iş. Tarayıcı canvas'ı desteklemiyorsa ya da
 * görüntü çözülemiyorsa problem raporu yine de fotoğrafıyla kaydedilmeli.
 */
export async function downscaleImage(file: File, max = MAX_DIMENSION): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  // Animasyonlu GIF tek kareye düşerdi; dokunmuyoruz.
  if (file.type === 'image/gif') return file

  try {
    const bitmap = await createImageBitmap(file)
    const size = fittedSize(bitmap.width, bitmap.height, max)
    if (size.width === bitmap.width && size.height === bitmap.height && file.size < 400_000) {
      bitmap.close?.()
      return file
    }

    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close?.()
      return file
    }
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob || blob.size >= file.size) return file

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}
