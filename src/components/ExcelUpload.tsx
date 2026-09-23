import * as XLSX from 'xlsx'
import { useState } from 'react'

interface ExcelUploadProps {
  expectedColumns: string[]
  onRows: (rows: Record<string, unknown>[]) => Promise<{ message: string }>
  /**
   * Bu yükleme mevcut kayıtların yerine geçiyorsa, neyin silineceğinin adı
   * (ör. "all stock rows"). Verilirse dosya seçildikten sonra onay sorulur —
   * yanlış dosya tek tıkla bütün veriyi siliyordu.
   */
  replaces?: string
  /**
   * Başlık satırındaki tarih hücrelerini YYYY-MM-DD metnine çevir. ZPP_DAILY
   * gibi her sütunu bir gün olan dosyalar için: Excel tarihi yerel biçimde
   * (9/16/26 ya da 16.09.2026) gösterir, gün/ay sırası belirsiz kalır.
   */
  isoDateHeaders?: boolean
}

export function ExcelUpload({ expectedColumns, onRows, replaces, isoDateHeaders }: ExcelUploadProps) {
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'loading' } | { kind: 'success'; message: string } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (
      replaces &&
      !window.confirm(
        `Upload "${file.name}"? This replaces ${replaces} with the contents of this file.`,
      )
    ) {
      return
    }

    setStatus({ kind: 'loading' })
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]
      if (!firstSheetName) throw new Error('No sheet found in the Excel file.')
      const sheet = workbook.Sheets[firstSheetName]
      if (isoDateHeaders) isoHeaderDates(sheet)
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
      })
      if (rows.length === 0) throw new Error('No data rows found in the Excel file.')

      const result = await onRows(rows)
      setStatus({ kind: 'success', message: result.message })
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'The file could not be processed.',
      })
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4">
      <p className="text-sm font-medium text-foreground">Bulk upload from Excel</p>
      <p className="mt-1 text-xs text-muted-foreground">
        The first row must be the header. Expected columns:{' '}
        <span className="font-mono">{expectedColumns.join(', ')}</span>
      </p>
      {replaces && (
        <p className="mt-1 text-xs font-medium text-amber-700">
          This upload replaces {replaces}.
        </p>
      )}
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFile}
        disabled={status.kind === 'loading'}
        className="mt-3 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
      />
      {status.kind === 'loading' && (
        <p className="mt-2 text-sm text-muted-foreground">Uploading…</p>
      )}
      {status.kind === 'success' && (
        <p className="mt-2 text-sm text-emerald-600">{status.message}</p>
      )}
      {status.kind === 'error' && (
        <p className="mt-2 text-sm text-destructive">{status.message}</p>
      )}
    </div>
  )
}

/** Başlık satırındaki tarih hücrelerini ISO metnine çevirir. */
function isoHeaderDates(sheet: XLSX.WorkSheet) {
  const ref = sheet['!ref']
  if (!ref) return
  const range = XLSX.utils.decode_range(ref)
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })] as XLSX.CellObject | undefined
    if (!cell) continue
    const isDate =
      cell.t === 'd' || (cell.t === 'n' && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z))
    if (!isDate) continue
    const parsed =
      cell.t === 'd' && cell.v instanceof Date
        ? { y: cell.v.getFullYear(), m: cell.v.getMonth() + 1, d: cell.v.getDate() }
        : XLSX.SSF.parse_date_code(Number(cell.v))
    if (!parsed) continue
    const iso = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
    cell.w = iso
    cell.t = 's'
    cell.v = iso
  }
}
