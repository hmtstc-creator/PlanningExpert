import * as XLSX from 'xlsx'

/**
 * Excel'i okumanın tek yolu. npm'deki xlsx 0.18.5'in bilinen iki açığı var
 * (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9);
 * düzeltilmiş sürüm yalnızca SheetJS'in kendi sunucusunda
 * (todolist.md 4.3 — paket değiştirilecek). O zamana kadar:
 * - dosya boyutu sınırı (aşırı büyük / bozuk dosya tarayıcıyı kilitlemesin),
 * - yalnızca .xlsx / .xls / .csv,
 * - formül, HTML ve stil okunmaz (yalnızca değerler),
 * - okuma yalnızca kullanıcının kendi tarayıcısında; sunucu Excel okumaz.
 */
export const MAX_EXCEL_BYTES = 25 * 1024 * 1024

export function checkExcelFile(file: { name: string; size: number }): string | null {
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) return 'Choose an Excel file (.xlsx, .xls) or .csv'
  if (file.size > MAX_EXCEL_BYTES) return `The file is larger than ${MAX_EXCEL_BYTES / 1024 / 1024} MB — export only the needed sheet or columns`
  return null
}

export function readWorkbook(buffer: ArrayBuffer, opts: Omit<XLSX.ParsingOptions, 'type'> = {}): XLSX.WorkBook {
  return XLSX.read(buffer, { ...opts, type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false })
}
