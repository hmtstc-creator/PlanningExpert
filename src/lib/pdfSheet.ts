// Ekrandaki sayfa parçasından PDF (planlamacı, 2026-10-16): grafikli sayfalar
// (KPI Dashboard, Loss Bridge, Daily Report, Trend Analysis, Losses Trend).
//
// Parça, kâğıt genişliğinde görünmez bir kopyaya alınır ("pdf-capture": Tailwind'in
// `print:` stilleri burada da geçerli — src/styles.css), açık temada yüksek
// çözünürlüklü görüntüye çevrilir ve jsPDF ile sayfalara yerleştirilir. Ekranda
// ne görünüyorsa PDF'te o; yazılar görüntü olduğu için seçilemez.

export interface SheetLayout {
  size: 'A3' | 'A4'
  orientation: 'landscape' | 'portrait'
  /**
   * `fit`: tek sayfa, parça sayfaya sığdırılır (KPI Dashboard, Loss Bridge, Daily Report).
   * `flow`: çok sayfa, `.print-avoid-break` bölümleri sayfa arasında bölünmez (Trend Analysis, Losses Trend).
   */
  pages: 'fit' | 'flow'
  /** Kenar boşluğu (mm); yoksa fit 5, flow 8. */
  marginMm?: number
  /**
   * Kopyanın genişliği (px); yoksa fit ekrandaki, flow kâğıt genişliği. Sabit
   * genişlikte çizilen sayfa (Asakai) flow'da kırpılmasın, sayfaya küçülsün diye.
   */
  widthPx?: number
}

const PAPER_MM = { A3: [297, 420], A4: [210, 297] } as const
const PX_PER_MM = 96 / 25.4

export function pageMm(size: 'A3' | 'A4', orientation: 'landscape' | 'portrait'): { w: number; h: number } {
  const [short, long] = PAPER_MM[size]
  return orientation === 'landscape' ? { w: long, h: short } : { w: short, h: long }
}

/**
 * Uzun parçanın sayfalara bölünmesi: her sayfa en çok `pageH` (px) yüksekliğinde;
 * bir bölüm (`blocks`: üst / alt kenarı) sayfa sınırına denk gelirse sayfa o
 * bölümün üstünden kesilir. Sayfadan uzun bölüm mecburen bölünür.
 */
export function pageSlices(total: number, pageH: number, blocks: { top: number; bottom: number }[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  let from = 0
  while (from < total - 0.5) {
    let to = Math.min(total, from + pageH)
    if (to < total) {
      const crossing = blocks.filter((b) => b.top < to && b.bottom > to && b.top > from + 0.5)
      if (crossing.length) to = Math.min(...crossing.map((b) => b.top))
    }
    out.push({ from, to })
    from = to
  }
  return out
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

/** Parçayı PDF'e çevirir (Blob). */
export async function sheetToPdf(sheet: HTMLElement, layout: SheetLayout): Promise<Blob> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')])
  const page = pageMm(layout.size, layout.orientation)
  const margin = layout.marginMm ?? (layout.pages === 'flow' ? 8 : 5)
  const contentMm = { w: page.w - 2 * margin, h: page.h - 2 * margin }
  // fit: ekrandaki genişlik (görünüm aynen kalır, sayfaya sığdırılır); flow: kâğıt genişliği.
  const widthPx =
    layout.widthPx ?? (layout.pages === 'fit' && sheet.offsetWidth > 0 ? sheet.offsetWidth : Math.round(contentMm.w * PX_PER_MM))

  const root = document.documentElement
  const wasDark = root.classList.contains('dark')
  const box = document.createElement('div')
  box.className = 'pdf-capture'
  Object.assign(box.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${widthPx}px`,
    background: '#ffffff',
    zIndex: '-1',
  })
  const copy = sheet.cloneNode(true) as HTMLElement
  copy.style.transform = 'none'
  // Grafikler ekranda ölçülen genişlikte çizilir: kâğıda sığmazsa orantılı küçülür.
  for (const svg of copy.querySelectorAll('svg')) {
    const w = parseFloat(svg.getAttribute('width') ?? '')
    const h = parseFloat(svg.getAttribute('height') ?? '')
    if (!(w > 0 && h > 0)) continue
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    svg.style.maxWidth = '100%'
    svg.style.height = 'auto'
  }
  box.appendChild(copy)
  try {
    // Açık tema: koyu temada da PDF beyaz kâğıt.
    if (wasDark) root.classList.remove('dark')
    document.body.appendChild(box)
    await document.fonts?.ready
    await frame()
    await frame()
    resolveSvgColors(box)
    const boxRect = box.getBoundingClientRect()
    const blocks = [...box.querySelectorAll<HTMLElement>('.print-avoid-break')].map((el) => {
      const r = el.getBoundingClientRect()
      return { top: r.top - boxRect.top, bottom: r.bottom - boxRect.top }
    })
    const scale = 2
    // Kopya ekran dışında duruyor; görüntüde konumu sıfır (yoksa resim boş çıkar).
    const canvas = await toCanvas(box, {
      pixelRatio: scale,
      backgroundColor: '#ffffff',
      cacheBust: false,
      width: box.offsetWidth,
      height: box.offsetHeight,
      style: { position: 'static', left: '0', top: '0', zIndex: 'auto' },
    })
    const cssW = canvas.width / scale
    const cssH = canvas.height / scale

    const pdf = new jsPDF({ unit: 'mm', format: layout.size.toLowerCase(), orientation: layout.orientation, compress: true })
    if (layout.pages === 'fit') {
      const k = Math.min(contentMm.w / cssW, contentMm.h / cssH)
      // Sayfaya sığdırılır, yatayda ortalanır.
      pdf.addImage(canvas, 'PNG', margin + (contentMm.w - cssW * k) / 2, margin, cssW * k, cssH * k, undefined, 'FAST')
    } else {
      // Sayfa yüksekliği parçanın ölçeğinde (px).
      const mmPerPx = contentMm.w / cssW
      const slices = pageSlices(cssH, contentMm.h / mmPerPx, blocks)
      slices.forEach((s, i) => {
        if (i > 0) pdf.addPage()
        const part = document.createElement('canvas')
        part.width = canvas.width
        part.height = Math.max(1, Math.round((s.to - s.from) * scale))
        const ctx = part.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, part.width, part.height)
        ctx.drawImage(canvas, 0, Math.round(s.from * scale), canvas.width, part.height, 0, 0, part.width, part.height)
        pdf.addImage(part, 'PNG', margin, margin, contentMm.w, (s.to - s.from) * mmPerPx, undefined, 'FAST')
      })
    }
    return pdf.output('blob')
  } finally {
    box.remove()
    if (wasDark) root.classList.add('dark')
  }
}

const SVG_PAINT = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color'] as const

/**
 * Grafikler rengi SVG özniteliğinde CSS değişkeniyle verir (ör. fill="var(--viz-1)").
 * Görüntüye çeviren kopya değişkenleri taşımaz (renk siyah çıkar): öznitelikler
 * tarayıcının hesapladığı renkle değiştirilir. Yalnızca PDF kopyasında.
 */
export function resolveSvgColors(root: HTMLElement) {
  for (const el of root.querySelectorAll<SVGElement>('svg, svg *')) {
    const cs = getComputedStyle(el)
    for (const attr of SVG_PAINT) {
      const raw = el.getAttribute(attr)
      if (!raw || !raw.includes('var(')) continue
      const value = cs.getPropertyValue(attr)
      if (value) el.setAttribute(attr, value)
    }
    const style = el.getAttribute('style')
    if (style && style.includes('var(')) for (const attr of SVG_PAINT) {
      const v = el.style.getPropertyValue(attr)
      if (v && v.includes('var(')) el.style.setProperty(attr, cs.getPropertyValue(attr))
    }
  }
}
