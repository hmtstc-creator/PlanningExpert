// Bir sayfa parçasını A3 yatay olarak yazdırır (KPI dashboard, OEE Loss Bridge).

/**
 * Yalnızca A3 sayfasını yazdırır: görünmez bir çerçeveye sayfanın stilleri
 * ve sayfa kopyalanır, A3 yatay ve kenar boşluksuz yazdırılır (tarayıcıda
 * "Save as PDF" ile PDF olur). Ölçü ekran ölçeğinden bağımsızdır.
 */
export function printSheet(sheet: HTMLElement, fileName: string) {
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  if (!doc) return
  const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join('')
  doc.open()
  doc.write(
    `<!doctype html><html class="${document.documentElement.className.replace(/\bdark\b/, '')}"><head><meta charset="utf-8"><title>${fileName}</title>${styles}<style>@page{size:A3 landscape;margin:0}html,body{margin:0;padding:0;background:#fff}</style></head><body>${sheet.outerHTML}</body></html>`,
  )
  doc.close()
  const go = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1000)
  }
  // Stiller yüklensin.
  if (doc.readyState === 'complete') setTimeout(go, 300)
  else frame.onload = () => setTimeout(go, 300)
}
