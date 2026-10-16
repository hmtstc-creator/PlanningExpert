// Agent Report'un PDF'i (planlamacı, 2026-10-16): A4 dikey, metin — yazılar seçilir
// ve aranır, dosya küçük. Yazı tipi Liberation Sans (SIL OFL, public/fonts): Türkçe
// ve Romence harfler (ş ğ ı ș ț ă …) için PDF'e gömülür; yalnızca PDF üretilirken yüklenir.

import { dmShort, type AgentNote, type AgentReport, type NoteLevel, type NoteSection } from './oeeAgent'

const LEVEL: Record<NoteLevel, { label: string; rgb: [number, number, number] }> = {
  critical: { label: 'CRITICAL', rgb: [198, 40, 40] },
  warning: { label: 'WARNING', rgb: [217, 119, 6] },
  watch: { label: 'WATCH', rgb: [42, 120, 214] },
  good: { label: 'GOOD NEWS', rgb: [19, 121, 91] },
}

export interface AgentPdfMeta {
  title: string
  headline: string
  filters: string[]
  sections: Record<NoteSection, { title: string; hint: string }>
}

const ORDER: NoteSection[] = ['dies', 'machines', 'shifts', 'repeats', 'topics', 'good']
const FONT = 'LiberationSans'

async function fontBase64(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Font ${url} could not be loaded (${res.status})`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export async function agentReportPdf(report: AgentReport, meta: AgentPdfMeta): Promise<Blob> {
  const [{ jsPDF }, regular, bold] = await Promise.all([
    import('jspdf'),
    fontBase64('/fonts/LiberationSans-Regular.ttf'),
    fontBase64('/fonts/LiberationSans-Bold.ttf'),
  ])
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })
  pdf.addFileToVFS('LiberationSans-Regular.ttf', regular)
  pdf.addFont('LiberationSans-Regular.ttf', FONT, 'normal')
  pdf.addFileToVFS('LiberationSans-Bold.ttf', bold)
  pdf.addFont('LiberationSans-Bold.ttf', FONT, 'bold')
  pdf.setProperties({ title: meta.title, subject: 'OEE Agent Report', creator: 'Production Portal' })

  const W = 210
  const H = 297
  const M = 14
  const TW = W - 2 * M
  const BOTTOM = H - 14
  let y = M

  const font = (size: number, style: 'normal' | 'bold' = 'normal', rgb: [number, number, number] = [29, 29, 27]) => {
    pdf.setFont(FONT, style)
    pdf.setFontSize(size)
    pdf.setTextColor(...rgb)
  }
  const lh = (size: number) => size * 0.3528 * 1.3
  const lines = (text: string, width: number) => pdf.splitTextToSize(text, width) as string[]
  const ensure = (needed: number) => {
    if (y + needed > BOTTOM) {
      pdf.addPage()
      y = M
    }
  }
  const write = (text: string, size: number, style: 'normal' | 'bold', rgb?: [number, number, number], x = M, width = TW) => {
    font(size, style, rgb)
    for (const l of lines(text, width)) {
      ensure(lh(size))
      pdf.text(l, x, y + lh(size) * 0.75)
      y += lh(size)
    }
  }

  // Başlık
  write(meta.title, 16, 'bold')
  write(meta.filters.filter(Boolean).join(' · '), 9, 'normal', [95, 94, 90])
  y += 1.5
  write(meta.headline, 10.5, 'bold')
  y += 1
  if (report.notices.length) {
    for (const n of report.notices) write(`! ${n}`, 8.5, 'normal', [146, 64, 14])
    y += 1
  }

  // Yönetim özeti
  ensure(12)
  pdf.setDrawColor(30, 58, 95)
  pdf.setLineWidth(0.5)
  pdf.line(M, y, W - M, y)
  y += 2
  write('SUMMARY FOR MANAGEMENT', 10, 'bold', [30, 58, 95])
  y += 0.5
  if (!report.summary.length) write(`No critical point or warning on ${dmShort(report.day)}.`, 10, 'normal')
  report.summary.forEach((n, i) => {
    const text = `${i + 1}. [${LEVEL[n.level].label}] ${n.title} → ${n.owner}`
    write(text, 10, 'normal', undefined, M + 2, TW - 2)
    y += 0.8
  })
  y += 2

  // Bölümler
  for (const s of ORDER) {
    const notes = report.sections[s]
    // Başlık ilk notuyla aynı sayfada (sayfa dibinde yalnız kalmasın).
    ensure(32)
    pdf.setDrawColor(200, 199, 194)
    pdf.setLineWidth(0.2)
    pdf.line(M, y, W - M, y)
    y += 1.5
    write(meta.sections[s].title.toUpperCase(), 11, 'bold')
    write(meta.sections[s].hint, 8, 'normal', [95, 94, 90])
    y += 0.8
    if (!notes.length && !(s === 'topics' && (report.quietTopics.length || report.affectedTopics.length))) {
      write('Nothing to report.', 9, 'normal', [95, 94, 90])
      y += 1
    }
    for (const n of notes) note(n)
    if (report.hidden[s] > 0) write(`+ ${report.hidden[s]} smaller note${report.hidden[s] === 1 ? '' : 's'} not shown.`, 8.5, 'normal', [95, 94, 90])
    if (s === 'topics' && report.affectedTopics.length) {
      write(`Cost time on ${dmShort(report.day)}: ${report.affectedTopics.join(' · ')}`, 8.5, 'normal', [70, 70, 66])
      y += 1
    }
    if (s === 'topics' && report.quietTopics.length) {
      write(`No loss on ${dmShort(report.day)}: ${report.quietTopics.join(' · ')}`, 8.5, 'normal', [95, 94, 90])
      y += 1
    }
    y += 1.5
  }

  function note(n: AgentNote) {
    const l = LEVEL[n.level]
    const x = M + 4
    const width = TW - 4
    font(10, 'bold')
    const titleLines = lines(n.title, width - 22)
    font(8.5, 'normal')
    const evLines = lines(n.evidence, width)
    const height = titleLines.length * lh(10) + evLines.length * lh(8.5) + lh(7.5) + 2
    ensure(Math.min(height, BOTTOM - M))
    const top = y
    // Sol şerit ve seviye etiketi.
    pdf.setFillColor(...l.rgb)
    pdf.rect(M, top, 1.2, height - 1, 'F')
    font(7, 'bold', l.rgb)
    pdf.text(l.label, x, y + lh(10) * 0.75)
    font(10, 'bold')
    for (const t of titleLines) {
      ensure(lh(10))
      pdf.text(t, x + 20, y + lh(10) * 0.75)
      y += lh(10)
    }
    font(8.5, 'normal', [70, 70, 66])
    for (const t of evLines) {
      ensure(lh(8.5))
      pdf.text(t, x, y + lh(8.5) * 0.75)
      y += lh(8.5)
    }
    font(7.5, 'normal', [95, 94, 90])
    ensure(lh(7.5))
    pdf.text(`Owner: ${n.owner}${n.link ? ` · See: ${n.link.label}` : ''}`, x, y + lh(7.5) * 0.75)
    y += lh(7.5) + 2
  }

  // Alt bilgi: her sayfada ad ve sayfa numarası.
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    font(7.5, 'normal', [120, 119, 114])
    pdf.text(`${meta.title} · created ${new Date().toLocaleString('en-GB')}`, M, H - 7)
    pdf.text(`Page ${i} of ${pages}`, W - M, H - 7, { align: 'right' })
  }
  return pdf.output('blob')
}
