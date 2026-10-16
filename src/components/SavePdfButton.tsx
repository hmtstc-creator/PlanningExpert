import { FileDown } from 'lucide-react'
import { useState } from 'react'

import { savePdf } from '../lib/pdfFile'

/**
 * Sitedeki bütün çıktılar (planlamacı, 2026-10-16): "Save PDF" — PDF sayfada
 * üretilir, kayıt penceresi Masaüstünde ve ad dolu açılır (src/lib/pdfFile.ts).
 * `make`: PDF'i üreten iş (ör. sheetToPdf).
 */
export function SavePdfButton({
  fileName,
  make,
  disabled,
  variant = 'filter',
  label = 'Save PDF',
}: {
  fileName: string
  make: () => Promise<Blob>
  disabled?: boolean
  /** filter: OEE filtre çubuğu (koyu mavi); plain: sayfa içi küçük düğme. */
  variant?: 'filter' | 'plain'
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setNote(null)
    try {
      // Önce kayıt penceresi (tıklamanın hemen ardından), sonra PDF.
      const result = await savePdf(make, fileName)
      if (result === 'downloaded') setNote(`Saved to your downloads as "${fileName}.pdf".`)
    } catch (e) {
      setNote(`The PDF could not be created: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const cls =
    variant === 'filter'
      ? 'flex items-center gap-1.5 rounded-md bg-[#1e3a5f] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#28507f] disabled:opacity-50 dark:bg-[#dbe7f3] dark:text-[#1e3a5f]'
      : 'flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50'
  return (
    <span className="inline-flex flex-col items-end gap-1 print:hidden">
      <button type="button" onClick={() => void run()} disabled={disabled || busy} title={`Save as "${fileName}.pdf"`} className={cls}>
        <FileDown className={variant === 'filter' ? 'h-4 w-4' : 'h-3.5 w-3.5'} aria-hidden /> {busy ? 'Creating PDF…' : label}
      </button>
      {note && <span className="max-w-xs text-right text-[11px] text-muted-foreground">{note}</span>}
    </span>
  )
}
