// Bir sayfa parçasını yazdırır: A3 yatay (KPI dashboard, OEE Loss Bridge) ya
// da A4 yatay, çok sayfa (OEE Trend Analysis, Losses Trend).

export type SheetSize = 'A3' | 'A4'

/**
 * Yalnızca sayfa parçasını yazdırır: görünmez bir çerçeveye sayfanın stilleri
 * ve parça kopyalanır, yatay yazdırılır (tarayıcıda "Save as PDF" ile PDF
 * olur). Ölçü ekran ölçeğinden bağımsızdır. `fileName` PDF'in önerilen adıdır:
 * tarayıcı belge başlığını dosya adı olarak önerir. Tarayıcı dosyayı kendisi
 * bir klasöre (ör. masaüstü) yazamaz; kayıt penceresi bu adla açılır, Chrome
 * son seçilen klasörü hatırlar.
 *
 * A4: kenar boşluklu, birden çok sayfa; `.print-avoid-break` bölümleri
 * sayfa arasında bölünmez.
 */
export function printSheet(sheet: HTMLElement, fileName: string, size: SheetSize = 'A3') {
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (!doc) return
  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('')
  const page =
    size === 'A4'
      ? '@page{size:A4 landscape;margin:8mm}html,body{margin:0;padding:0;background:#fff}.print-avoid-break{break-inside:avoid;page-break-inside:avoid}'
      : '@page{size:A3 landscape;margin:0}html,body{margin:0;padding:0;background:#fff}'
  const title = fileName.replace(/[<>&"]/g, '')
  doc.open()
  doc.write(
    `<!doctype html><html class="${document.documentElement.className.replace(/\bdark\b/, '')}"><head><meta charset="utf-8"><title>${title}</title>${styles}<style>${page}</style></head><body>${sheet.outerHTML}</body></html>`,
  )
  doc.close()
  const go = () => {
    // Bazı tarayıcılar PDF adını üst belgenin başlığından önerir: yazdırma boyunca o da aynı.
    const before = document.title
    document.title = title
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => {
      document.title = before
      frame.remove()
    }, 1000)
  }
  // Stiller yüklensin.
  if (doc.readyState === 'complete') setTimeout(go, 300)
  else frame.onload = () => setTimeout(go, 300)
}
