/**
 * PDF'in başı (Aksiyonlar sunumu, 2026-10-14): başlık ve seçili filtreler — PDF
 * tek başına okunduğunda da anlamlı. Yalnızca PDF'te görünür (`print:` →
 * src/lib/pdfSheet.ts); düğme: SavePdfButton.
 */
export function PrintFilterHeader({ title, filters }: { title: string; filters: string[] }) {
  return (
    <div className="mb-3 hidden border-b border-neutral-300 pb-2 print:block">
      <p className="text-lg font-bold text-black">{title}</p>
      <p className="text-xs text-neutral-700">
        <b>Filters:</b> {filters.filter(Boolean).join(' · ')}
      </p>
      <p className="text-[10px] text-neutral-500">Created {new Date().toLocaleString('en-GB')}</p>
    </div>
  )
}
