/**
 * Şema uyumluluğu (veri kaybını önleme, docs/deployment.md → Veri güvenliği).
 *
 * Canlı veritabanında kayıt varken şema yalnızca **genişleyebilir**:
 * - tablo ya da alan kaldırılmaz,
 * - isteğe bağlı alan zorunlu yapılmaz,
 * - var olan tabloya / nesneye yeni zorunlu alan eklenmez,
 * - tip daraltılmaz (genişletmek serbest: birlik, any).
 * Kural ihlali CI'da yakalanır (convex/schemaGuard.test.ts); deploy'a gitmez.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

export interface FieldShape {
  fieldType: Json
  optional: boolean
}

export type SchemaShape = Record<string, Record<string, FieldShape>>

/** convex/schema.ts → tablo → alan → { tip, isteğe bağlı }. */
export function shapeOf(schema: { tables: Record<string, { validator: { json: Json } }> }): SchemaShape {
  const out: SchemaShape = {}
  for (const [name, table] of Object.entries(schema.tables).sort(([a], [b]) => a.localeCompare(b))) {
    const json = table.validator.json
    const fields: Record<string, FieldShape> = {}
    if (json.type === 'object') {
      for (const [f, spec] of Object.entries(json.value as Record<string, FieldShape>).sort(([a], [b]) => a.localeCompare(b))) fields[f] = spec
    } else {
      fields['*'] = { fieldType: json, optional: false }
    }
    out[name] = fields
  }
  return out
}

/** Eski tipteki her değer yeni tipte de geçerli mi? */
export function typeAccepts(oldT: Json, newT: Json): boolean {
  if (JSON.stringify(oldT) === JSON.stringify(newT)) return true
  if (newT.type === 'any') return true
  if (oldT.type === 'union') return (oldT.value as Json[]).every((m) => typeAccepts(m, newT))
  if (newT.type === 'union') return (newT.value as Json[]).some((m) => typeAccepts(oldT, m))
  if (oldT.type !== newT.type) return false
  switch (newT.type) {
    case 'object':
      return objectAccepts(oldT.value, newT.value).length === 0
    case 'array':
      return typeAccepts(oldT.value, newT.value)
    case 'record':
      return typeAccepts(oldT.keys, newT.keys) && typeAccepts(oldT.values?.fieldType ?? oldT.values, newT.values?.fieldType ?? newT.values)
    case 'literal':
      return oldT.value === newT.value
    case 'id':
      return oldT.tableName === newT.tableName
    default:
      return false
  }
}

/** Nesne alanları için uyumsuzluklar (boşsa uyumlu). */
function objectAccepts(oldF: Record<string, FieldShape>, newF: Record<string, FieldShape>, where = ''): string[] {
  const problems: string[] = []
  for (const [f, o] of Object.entries(oldF)) {
    const n = newF[f]
    if (!n) problems.push(`${where}${f}: removed`)
    else {
      if (o.optional && !n.optional) problems.push(`${where}${f}: became required`)
      if (!typeAccepts(o.fieldType, n.fieldType)) problems.push(`${where}${f}: type narrowed or changed`)
    }
  }
  for (const [f, n] of Object.entries(newF)) if (!oldF[f] && !n.optional) problems.push(`${where}${f}: new field must be optional`)
  return problems
}

/** Kayıtlı şemadan (snapshot) yeni şemaya geçişin sorunları. */
export function schemaProblems(before: SchemaShape, after: SchemaShape): string[] {
  const problems: string[] = []
  for (const [table, fields] of Object.entries(before)) {
    if (!after[table]) {
      problems.push(`${table}: table removed`)
      continue
    }
    problems.push(...objectAccepts(fields, after[table], `${table}.`))
  }
  return problems
}

/** Kayıtta olmayan yeni tablo / alanlar (kayıt güncellenmeli). */
export function unrecorded(before: SchemaShape, after: SchemaShape): string[] {
  const out: string[] = []
  for (const [table, fields] of Object.entries(after)) {
    if (!before[table]) out.push(`${table} (new table)`)
    else for (const f of Object.keys(fields)) if (!before[table][f]) out.push(`${table}.${f}`)
  }
  return out
}

/**
 * Kaydı günceller: eski kayıttaki hiçbir şey silinmez (kaldırma ancak kayıt
 * elle düzenlenerek, iki adımlı geçişten sonra yapılır).
 */
export function mergeShapes(before: SchemaShape, after: SchemaShape): SchemaShape {
  const out: SchemaShape = {}
  for (const table of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    out[table] = { ...(before[table] ?? {}), ...(after[table] ?? {}) }
    out[table] = Object.fromEntries(Object.entries(out[table]).sort(([a], [b]) => a.localeCompare(b)))
  }
  return out
}
