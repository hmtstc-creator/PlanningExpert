// SOP formu: şablonun (docs/sop/sop-sablon.xlsx) hücre haritası — tek kaynak
// burası, ekran ve PDF buradan çizilir. Kural (kullanıcı, 2026-10-29): çıktı
// şablona %100 uyar; yapı asla değişmez, 6 adımdan fazlası için sayfa
// çoğaltılır (docs/wiki/12-sop-olusturma.md). sopLayout.test.ts ölçüleri ve
// birleştirmeleri şablon dosyasının kendisiyle karşılaştırır.

export const COLS = 55

/** Satır yüksekliği (pt); yazılmayanlar 15. */
export const ROWS = 86
const ROW_PT: Record<number, number> = { 8: 28.5, 10: 26, 11: 54, 34: 39, 68: 41.25 }
export const rowPt = (row: number): number => ROW_PT[row] ?? 15
export const rowPx = (row: number): number => (rowPt(row) * 4) / 3

/**
 * A3 yatay baskı (420 × 297 mm), her yanda sabit kenar boşluğu. Formun oranı
 * (şablonda ≈ 1,01) A3 yatayın (≈ 1,41) çok altındaydı: sayfanın iki yanında
 * boşluk kalıyordu. Sütun genişliği (B…BC, şablonun 33 px'i) bu oranı dolduracak
 * şekilde tek yerden büyütülür; A sütunu ve satırlar şablondaki gibi kalır.
 * Sapma kararı: docs/wiki/12-sop-olusturma.md (2026-10-31).
 */
export const PRINT_MARGIN_MM = 5
const A3_LANDSCAPE_MM = { w: 420, h: 297 }
const COL_A_PX = 109
const sheetHeightPx = Array.from({ length: ROWS }, (_, r) => rowPx(r + 1)).reduce((a, b) => a + b, 0)
const targetWidthPx = sheetHeightPx * ((A3_LANDSCAPE_MM.w - 2 * PRINT_MARGIN_MM) / (A3_LANDSCAPE_MM.h - 2 * PRINT_MARGIN_MM))
const COL_PX = (targetWidthPx - COL_A_PX) / (COLS - 1)

/** Sütun genişliği (px): A = 109, B…BC = türetilmiş (≈ 47,5). */
export const colPx = (col: number): number => (col === 1 ? COL_A_PX : COL_PX)

/** `BC` → 55 */
export function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

export interface Range {
  c1: number
  r1: number
  c2: number
  r2: number
}

/** `B12:S30` (ya da tek hücre `AW1`) → 1 tabanlı aralık. */
export function parseRange(ref: string): Range {
  const [a, b = a] = ref.split(':')
  const cell = (s: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(s)
    if (!m) throw new Error(`Bad cell ${s}`)
    return { c: colIndex(m[1]), r: Number(m[2]) }
  }
  const p = cell(a)
  const q = cell(b)
  return { c1: p.c, r1: p.r, c2: q.c, r2: q.r }
}

const sum = (from: number, to: number, f: (i: number) => number) => {
  let s = 0
  for (let i = from; i <= to; i++) s += f(i)
  return s
}

export const SHEET_W = sum(1, COLS, colPx)
export const SHEET_H = sum(1, ROWS, rowPx)

/** Aralığın sayfadaki yeri (px). */
export function rect(ref: string): { left: number; top: number; width: number; height: number } {
  const r = parseRange(ref)
  return {
    left: sum(1, r.c1 - 1, colPx),
    top: sum(1, r.r1 - 1, rowPx),
    width: sum(r.c1, r.c2, colPx),
    height: sum(r.r1, r.r2, rowPx),
  }
}

/** Başlıktaki yazılabilir alanlar (kullanıcı 2026-10-29: hepsi ekranda elle yazılır). */
export const HEADER_FIELDS = [
  'unit',
  'tut',
  'tutValue',
  'project',
  'projectExtra',
  'operation',
  'issuedBy',
  'issueDate',
  'revisionDate',
  'revisionNo',
  'revisionReason',
  'reference',
  'sopNo',
] as const
export type HeaderField = (typeof HEADER_FIELDS)[number]
export type Header = Record<HeaderField, string>

/** `TÜT` kutusu şablonda yazılı gelir; kullanıcı değiştirebilir. */
export const HEADER_DEFAULTS: Header = {
  unit: '',
  tut: 'TÜT',
  tutValue: '',
  project: '',
  projectExtra: '',
  operation: '',
  issuedBy: '',
  issueDate: '',
  revisionDate: '',
  revisionNo: '',
  revisionReason: '',
  reference: '',
  sopNo: '',
}

export interface Font {
  size: number
  bold?: boolean
  italic?: boolean
  family?: 'arial'
  color?: string
}

export type Region =
  | { ref: string; kind: 'logo' }
  | { ref: string; kind: 'text'; text: string; font: Font; align?: 'left'; border: Border; fill?: string }
  | { ref: string; kind: 'field'; field: HeaderField; font: Font; border: Border }
  | { ref: string; kind: 'page'; font: Font; border: Border }
  | { ref: string; kind: 'blank'; border: Border; fill?: string }
  /** Başlık altı şerit: şablonda boş; onay alanları (hazırlayan / kontrol / onaylayan) burada. */
  | { ref: string; kind: 'approval'; border: Border }

/** Kenarlık kalınlığı: şablonda başlık iç çizgileri ince, bloklar orta. */
export type Border = 'thin' | 'medium'

const GREEN = '#00B050'
const GREY = '#BFBFBF'
const label = (ref: string, text: string, size = 16, extra: Partial<Font> = {}, border: Border = 'medium'): Region => ({
  ref,
  kind: 'text',
  text,
  font: { size, bold: true, ...extra },
  border,
})
const field = (ref: string, f: HeaderField, bold = false, border: Border = 'thin'): Region => ({
  ref,
  kind: 'field',
  field: f,
  font: { size: 16, bold },
  border,
})
const meta = (row: number, name: string, value: string): Region[] => [
  { ref: `AR${row}:AV${row}`, kind: 'text', text: name, font: { size: 11 }, align: 'left', border: 'thin' },
  { ref: `AW${row}:BC${row}`, kind: 'text', text: value, font: { size: 10, family: 'arial' }, border: 'thin' },
]

/** Adım bantları: satır aralıkları (şablonda bant 2'nin fotoğrafı bir satır kısa). */
export const BANDS = [
  { photo: [12, 30], step: [31, 34], key: [35, 40], reason: [41, 46], numberRow: 27 },
  { photo: [47, 64], step: [65, 68], key: [69, 74], reason: [75, 80], numberRow: 61 },
] as const

/** Bir banttaki üç adım sütunu. */
export const SLOT_COLS = [
  ['B', 'S'],
  ['T', 'AK'],
  ['AL', 'BC'],
] as const

/** Sabit metinler (kullanıcı 2026-10-29: künye ve form kodu sabit). */
export const TITLE = 'PROCEDURĂ STANDARD DE OPERARE (SOP)'
export const FORM_CODE = 'S1-P1F12/Rev.01'
export const DISCLAIMER =
  'Toate versiunile tipărite ale acestui document sunt COPII NECONTROLATE. Doar versiunea curentă în QDMS este COPIE CONTROLATĂ. / Tüm çıktı alınmış versiyonları KONTROLSÜZ KOPYAdır. Sadece QDMS\'te yer alan mevcut versiyon KONTROLLÜ KOPYAdır. '

/** Adım dışındaki bütün kutular (başlık, künye, KKD etiketi, alt bilgi). */
export const REGIONS: Region[] = [
  { ref: 'A1:H7', kind: 'logo' },
  { ref: 'I1:AQ5', kind: 'text', text: TITLE, font: { size: 20, bold: true, family: 'arial' }, border: 'medium' },
  { ref: 'I6:AW7', kind: 'approval', border: 'medium' },
  ...meta(1, 'Issued Date:  ', '10.02.2011'),
  ...meta(2, 'Revision Date:', '26.02.2024'),
  ...meta(3, 'Revision No:', '1'),
  ...meta(4, 'Confidency Classification', 'L2'),
  ...meta(5, 'Document No', 'S5-P2T3F1'),
  label('AX6:AZ7', 'PAG'),
  { ref: 'BA6:BC7', kind: 'page', font: { size: 16 }, border: 'medium' },
  label('A8:C9', 'UNITATEA DE PRODUCȚIE'),
  field('D8:I9', 'unit', true),
  field('J8:M9', 'tut', true),
  field('N8:P9', 'tutValue'),
  label('Q8:T9', 'PROIECT', 16, { color: GREEN }, 'thin'),
  field('U8:AB9', 'project'),
  field('AC8:AG9', 'projectExtra'),
  label('AH8:AP9', 'NUME OPERAȚIE', 16, {}, 'thin'),
  field('AQ8:BC9', 'operation'),
  label('A10:C11', 'EMIS DE'),
  field('D10:I11', 'issuedBy', true),
  label('J10:P10', 'DATĂ EMITERE', 16, {}, 'thin'),
  field('J11:P11', 'issueDate'),
  label('Q10:U10', 'DATĂ REVIZIE', 16, {}, 'thin'),
  field('Q11:U11', 'revisionDate'),
  label('V10:Y10', 'NR. REVIZIE', 16, {}, 'thin'),
  field('V11:Y11', 'revisionNo'),
  label('Z10:AM10', 'MOTIV REVIZIE', 16, {}, 'thin'),
  field('Z11:AM11', 'revisionReason', true),
  label('AN10:AX10', 'REFERINȚĂ', 16, { color: GREEN }, 'thin'),
  field('AN11:AX11', 'reference', true),
  label('AY10:BC10', 'NR. SOP', 16, { color: GREEN }, 'thin'),
  field('AY11:BC11', 'sopNo', true),
  // İki adım bandının sol etiket sütunu.
  ...[0, 1].flatMap((band): Region[] => {
    const b = BANDS[band]
    return [
      { ref: `A${b.photo[0]}:A${b.photo[1]}`, kind: 'blank', border: 'medium' },
      label(`A${b.step[0]}:A${b.step[1]}`, 'PAȘI DE BAZĂ', 14),
      label(`A${b.key[0]}:A${b.key[1]}`, 'PUNCTE CHEIE', 14),
      label(`A${b.reason[0]}:A${b.reason[1]}`, 'CAUZE', 14),
    ]
  }),
  label('A81:G83', 'ECHIPAMENT DE PROTECȚIE PERSONAL', 14),
  { ref: 'H81:BC83', kind: 'blank', border: 'medium' },
  { ref: 'A84:AT86', kind: 'text', text: DISCLAIMER, font: { size: 16, bold: true, italic: true, color: GREEN }, border: 'medium' },
  { ref: 'AU84:BC86', kind: 'text', text: FORM_CODE, font: { size: 16, bold: true, italic: true, color: GREEN }, border: 'medium' },
]

export const STEPS_PER_PAGE = BANDS.length * SLOT_COLS.length
export const STEP_FONT: Font = { size: 14, bold: true }
export const STEP_FILL = GREY

/** Sayfadaki adım kutusu (0…5) → aralıklar ve numara kutusunun yeri. */
export function slotRefs(slot: number) {
  const band = BANDS[Math.floor(slot / SLOT_COLS.length)]
  const [c1, c2] = SLOT_COLS[slot % SLOT_COLS.length]
  const at = (rows: readonly [number, number]) => `${c1}${rows[0]}:${c2}${rows[1]}`
  return {
    photo: at(band.photo),
    step: at(band.step),
    key: at(band.key),
    reason: at(band.reason),
    // Numara kutusu: 63 × 63 px, Calibri 32 kalın; sütunun başı, satırın 16 px altı.
    number: { left: rect(`${c1}1`).left, top: rect(`A${band.numberRow}`).top + 16, size: 63 },
  }
}

/**
 * KKD kalemleri (kullanıcı 2026-10-31). Formun altındaki seçim panelinde her biri
 * bir kart; çıktıda yalnız işaretlenenler KKD satırında (H81:BC83) yanyana durur.
 * `icon`: public/sop/ppe/ altındaki basit görsel; kullanıcı kendi fotoğrafını yükleyebilir.
 */
export const PPE_ITEMS = [
  { key: 'shoes', ro: 'FOLOSIȚI PANTOFI DE PROTECȚIE', tr: 'İş ayakkabısı (çelik burunlu)', icon: 'shoes.jpg' },
  { key: 'gloves', ro: 'FOLOSIȚI MĂNUȘI DE PROTECȚIE', tr: 'İş eldiveni', icon: 'gloves.jpg' },
  { key: 'clothes', ro: 'FOLOSIȚI TRICOUL ȘI PANTALONII', tr: 'İş kıyafeti (tişört ve pantolon)', icon: 'clothes.jpg' },
  { key: 'short_sleeve', ro: 'MÂNECI SCURTE ADMISE', tr: 'Kısa kol uygunluğu', icon: 'short_sleeve.jpg' },
  { key: 'ear', ro: 'FOLOSIȚI PROTECȚIE AUDITIVĂ', tr: 'İşitme koruyucu (kulaklık)', icon: 'ear.jpg' },
  { key: 'glasses', ro: 'FOLOSIȚI OCHELARI DE PROTECȚIE', tr: 'İş güvenliği gözlüğü', icon: 'glasses.jpg' },
  { key: 'welding_mask', ro: 'FOLOSIȚI MASCĂ DE SUDURĂ', tr: 'Kaynak maskesi', icon: 'welding_mask.jpg' },
  { key: 'welding_goggles', ro: 'FOLOSIȚI OCHELARI DE SUDURĂ', tr: 'Kaynak gözlüğü', icon: 'welding_goggles.jpg' },
  { key: 'helmet', ro: 'FOLOSIȚI CASCĂ DE PROTECȚIE', tr: 'Baret', icon: 'helmet.jpg' },
  { key: 'harness', ro: 'FOLOSIȚI HAM DE SIGURANȚĂ', tr: 'Tam vücut emniyet kemeri (yüksekte çalışma, vinç)', icon: 'harness.jpg' },
  { key: 'respirator', ro: 'FOLOSIȚI MASCĂ RESPIRATORIE', tr: 'Solunum koruyucu maske (filtreli)', icon: 'respirator.jpg' },
  { key: 'face_shield', ro: 'FOLOSIȚI VIZIERĂ DE PROTECȚIE', tr: 'Yüz siperliği', icon: 'face_shield.jpg' },
  { key: 'vest', ro: 'FOLOSIȚI VESTĂ REFLECTORIZANTĂ', tr: 'Reflektörlü yelek', icon: 'vest.jpg' },
] as const
export type PpeKey = (typeof PPE_ITEMS)[number]['key']
export const PPE_KEYS = PPE_ITEMS.map((i) => i.key) as PpeKey[]
export const ppeIconUrl = (key: PpeKey): string => `/sop/ppe/${PPE_ITEMS.find((i) => i.key === key)?.icon ?? ''}`

/** KKD satırı H81:BC83: seçili `count` kalem eşit aralıklı, en çok 380 px genişlikte. */
export function ppeCellRects(count: number): { left: number; width: number }[] {
  const row = rect('H81:BC83')
  if (count <= 0) return []
  const width = Math.min(380, row.width / count)
  return Array.from({ length: count }, (_, i) => ({ left: row.left + i * width, width }))
}

/** Adımları sayfalara böler: her sayfa 6 kutu, boş kutu `null` (en az bir sayfa). */
export function paginate<T>(steps: readonly T[]): (T | null)[][] {
  const pages = Math.max(1, Math.ceil(steps.length / STEPS_PER_PAGE))
  return Array.from({ length: pages }, (_, p) =>
    Array.from({ length: STEPS_PER_PAGE }, (_, s) => steps[p * STEPS_PER_PAGE + s] ?? null),
  )
}

/** Adım numarası sayfalar arasında devam eder (2. sayfanın ilk kutusu 7). */
export const stepNumber = (page: number, slot: number) => page * STEPS_PER_PAGE + slot + 1

/** `PAG` kutusu: `1/2`. */
export const pageLabel = (page: number, pages: number) => `${page + 1}/${pages}`
