import { Printer } from 'lucide-react'

/**
 * A4 çıktısı (Aksiyonlar sunumu, 2026-10-14): filtre çubuğundaki düğme ve
 * çıktının başında seçili filtreler — PDF tek başına okunduğunda da anlamlı.
 */
export function PrintA4Button({ onPrint, fileName }: { onPrint: () => void; fileName: string }) {
  return (
    <button
      type="button"
      onClick={onPrint}
      title={`Print on A4 — save as PDF: "${fileName}.pdf"`}
      className="flex items-center gap-1.5 rounded-md bg-[#1e3a5f] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#28507f] dark:bg-[#dbe7f3] dark:text-[#1e3a5f]"
    >
      <Printer className="h-4 w-4" aria-hidden /> Print A4
    </button>
  )
}

/** Yalnızca çıktıda: başlık ve seçili filtreler. */
export function PrintFilterHeader({ title, filters }: { title: string; filters: string[] }) {
  return (
    <div className="mb-3 hidden border-b border-neutral-300 pb-2 print:block">
      <p className="text-lg font-bold text-black">{title}</p>
      <p className="text-xs text-neutral-700">
        <b>Filters:</b> {filters.filter(Boolean).join(' · ')}
      </p>
      <p className="text-[10px] text-neutral-500">Printed {new Date().toLocaleString('en-GB')}</p>
    </div>
  )
}
