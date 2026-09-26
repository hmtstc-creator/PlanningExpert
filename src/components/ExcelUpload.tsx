import * as XLSX from 'xlsx'
import { useState } from 'react'
import { friendlyError } from '../lib/mutationErrors'

interface ExcelUploadProps {
  expectedColumns: string[]
  onRows: (
    rows: Record<string, unknown>[],
    file: { fileName: string; onProgress: (done: number, total: number) => void },
  ) => Promise<{ message: string }>
  /**
   * Bu yükleme mevcut kayıtların yerine geçiyorsa, neyin silineceğinin adı
   * (ör. "all stock rows"). Önizlemede ve Kaydet düğmesinde gösterilir —
   * yanlış dosya tek tıkla bütün veriyi siliyordu.
   */
  replaces?: string
  /**
   * Başlık satırındaki tarih hücrelerini YYYY-MM-DD metnine çevir. ZPP_DAILY
   * gibi her sütunu bir gün olan dosyalar için: Excel tarihi yerel biçimde
   * (9/16/26 ya da 16.09.2026) gösterir, gün/ay sırası belirsiz kalır.
   */
  isoDateHeaders?: boolean
  /** Başlıkta mutlaka bulunması gereken sütunlar; eksikse uyarılır. */
  requiredColumns?: string[]
  /** Önizlemede gösterilecek kısa özet (ör. "covers W39 → W52"). */
  describe?: (rows: Record<string, unknown>[]) => string | undefined
}

type Status =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | {
      kind: 'preview'
      fileName: string
      sheetName: string
      rows: Record<string, unknown>[]
      missing: string[]
      summary?: string
    }
  | { kind: 'saving'; fileName: string; done?: number; total?: number }
  | { kind: 'success'; message: string; fileName: string; savedAt: Date }
  | { kind: 'error'; message: string }

/**
 * Excel yükleme, iki adımda: dosya seçilir ve okunur (henüz hiçbir şey
 * değişmez), önizleme gösterilir, "Save" ile kaydedilir. Eskiden dosya
 * seçildiği anda kaydediliyordu ve kullanıcı kaydın olup olmadığını
 * anlayamıyordu.
 */
export function ExcelUpload({
  expectedColumns,
  onRows,
  replaces,
  isoDateHeaders,
  requiredColumns,
  describe,
}: ExcelUploadProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setStatus({ kind: 'reading' })
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

      setStatus({
        kind: 'preview',
        fileName: file.name,
        sheetName: firstSheetName,
        rows,
        missing: missingColumns(rows[0], requiredColumns ?? []),
        summary: describe?.(rows),
      })
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'The file could not be read.',
      })
    }
  }

  async function save() {
    if (status.kind !== 'preview') return
    const { fileName, rows } = status
    setStatus({ kind: 'saving', fileName })
    try {
      const result = await onRows(rows, {
        fileName,
        onProgress: (done, total) => setStatus({ kind: 'saving', fileName, done, total }),
      })
      setStatus({ kind: 'success', message: result.message, fileName, savedAt: new Date() })
    } catch (err) {
      setStatus({
        kind: 'error',
        message:
          (friendlyError(err).message || 'The file could not be saved.') +
          ' Nothing was changed.',
      })
    }
  }

  const busy = status.kind === 'reading' || status.kind === 'saving'

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4">
      <p className="text-sm font-medium text-foreground">Upload from Excel</p>
      <p className="mt-1 text-xs text-muted-foreground">
        The first row must be the header. Expected columns:{' '}
        <span className="font-mono">{expectedColumns.join(', ')}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose the file, check the preview, then press <strong>Save</strong>. Nothing
        changes until you save.
      </p>
      {status.kind !== 'preview' && (
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          disabled={busy}
          aria-label="Choose Excel file"
          className="mt-3 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground"
        />
      )}
      {status.kind === 'reading' && (
        <p className="mt-2 text-sm text-muted-foreground">Reading the file…</p>
      )}
      {status.kind === 'preview' && (
        <div className="mt-3 rounded-md border border-border bg-background p-3 text-sm">
          <p className="font-medium text-foreground">
            {status.fileName}{' '}
            <span className="font-normal text-muted-foreground">
              — sheet “{status.sheetName}”, {status.rows.length.toLocaleString('en-GB')} rows
            </span>
          </p>
          {status.summary && <p className="mt-1 text-xs text-muted-foreground">{status.summary}</p>}
          {status.missing.length > 0 && (
            <p className="mt-1 text-xs font-medium text-destructive">
              Column not found: {status.missing.join(', ')}. Check that this is the right file.
            </p>
          )}
          {replaces && (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Saving replaces {replaces} with this file.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setStatus({ kind: 'idle' })}
              className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {status.kind === 'saving' && (
        <p className="mt-2 text-sm text-muted-foreground">
          Saving {status.fileName}…
          {status.total ? ` ${(status.done ?? 0).toLocaleString('en-GB')} / ${status.total.toLocaleString('en-GB')} rows` : ''}
        </p>
      )}
      {status.kind === 'success' && (
        <p className="mt-2 text-sm text-emerald-600">
          ✓ Saved {status.fileName} at{' '}
          {status.savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.{' '}
          {status.message}
        </p>
      )}
      {status.kind === 'error' && (
        <p className="mt-2 text-sm text-destructive">{status.message}</p>
      )}
    </div>
  )
}

/** Başlıkta bulunmayan zorunlu sütunlar (büyük/küçük harf ve boşluk önemsiz). */
export function missingColumns(firstRow: Record<string, unknown> | undefined, required: string[]) {
  const have = new Set(Object.keys(firstRow ?? {}).map((k) => k.trim().toLowerCase()))
  return required.filter((c) => !have.has(c.trim().toLowerCase()))
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
