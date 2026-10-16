// PDF dosyası: adı ve kaydı (planlamacı, 2026-10-16 — sitedeki bütün "Print"ler "Save PDF").
//
// Tarayıcı hiçbir siteye bilgisayara kendiliğinden yazma izni vermez. Chrome / Edge'de
// kayıt penceresi Masaüstü klasöründe, ad dolu açılır (File System Access API); tek tık
// "Kaydet". Desteklemeyen tarayıcıda (Firefox, Safari) dosya indirme klasörüne iner.

import { ddmmyy } from './oeeFilters'

/** "GGAAYY SAYFA ADI" — ör. `161026 OEE LOSS BRIDGE`. Dosya adında olamayan işaretler atılır. */
export function pdfFileName(dateIso: string, title: string): string {
  const name = `${ddmmyy(dateIso)} ${title}`
    .toUpperCase()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return name
}

type SavePicker = (opts: {
  suggestedName: string
  startIn?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>

export type SaveResult = 'saved' | 'downloaded' | 'cancelled'

/**
 * PDF'i kaydeder. Kayıt penceresi tıklamanın hemen ardından açılır (Chrome pencereyi
 * yalnızca kullanıcı tıklamasından sonraki birkaç saniye içinde açar); PDF ondan sonra
 * üretilir ve dosyaya yazılır. Pencere kapatılırsa PDF hiç üretilmez. Desteklemeyen
 * tarayıcıda PDF üretilip indirilir.
 */
export async function savePdf(make: () => Promise<Blob>, fileName: string): Promise<SaveResult> {
  const suggestedName = `${fileName}.pdf`
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  if (picker) {
    let handle: Awaited<ReturnType<SavePicker>> | null = null
    try {
      handle = await picker.call(window, {
        suggestedName,
        startIn: 'desktop',
        types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
      })
    } catch (e) {
      // Kullanıcı pencereyi kapattı.
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // Başka bir engel (ör. çerçeve içinde izin yok): indirmeye düş.
    }
    if (handle) {
      const blob = await make()
      const out = await handle.createWritable()
      await out.write(blob)
      await out.close()
      return 'saved'
    }
  }
  const blob = await make()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
