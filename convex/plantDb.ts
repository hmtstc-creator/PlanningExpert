import { ConvexError } from 'convex/values'

/**
 * Fabrikaya kilitli veritabanı erişimi (docs/plant-genisletme.md, bölüm 2).
 *
 * İşlevler `ctx.db`'yi bugünkü gibi kullanır; sarmalayıcı (convex/guarded.ts)
 * onlara bu kilitli erişimi verir:
 * - okuma: her sorgu `plantId = aktif fabrika` ile başlar (her index
 *   `plantId` ile başlar; index seçilmemişse `by_plant`),
 * - ekleme: kayda `plantId` konur,
 * - get / patch / replace / delete: kayıt başka fabrikanınsa okunmaz ya da
 *   reddedilir; `plantId` değiştirilemez.
 * İşlevlerin kendisi `plantId` yazmaz — unutulamaz.
 *
 * Fabrikadan bağımsız tablolar yalnızca PLATFORM_TABLES'takilerdir.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export const PLATFORM_TABLES = new Set([
  'companies',
  'holdings',
  'plants',
  'userGroups',
  'platformState',
  'users',
  'sessions',
  // Platform denetim kaydı (şirket / holding düzeyinde).
  'auditLog',
  // Uygulama içi hata kaydı (platform düzeyinde, yalnızca General görür).
  'errorLog',
  // Ülke resmi tatilleri: ortak referans.
  'officialHolidays',
])

export const isPlantTable = (table: string) => !PLATFORM_TABLES.has(table)

/** Fabrika anahtarı handler'a dönmez: dönüş doğrulayıcıları ve ekran bugünkü gibi kalır. */
export function hidePlant(doc: Any): Any {
  if (!doc || typeof doc !== 'object' || !('plantId' in doc)) return doc
  const { plantId: _p, ...rest } = doc
  return rest
}

/** Convex sorgusunu sarar: zincir (order, filter, withIndex…) korunur, sonuçlardan plantId çıkar. */
function wrapQuery(q: Any): Any {
  return {
    withIndex: (...a: Any[]) => wrapQuery(q.withIndex(...a)),
    order: (o: 'asc' | 'desc') => wrapQuery(q.order(o)),
    filter: (f: Any) => wrapQuery(q.filter(f)),
    collect: async () => (await q.collect()).map(hidePlant),
    first: async () => hidePlant(await q.first()),
    unique: async () => hidePlant(await q.unique()),
    take: async (n: number) => (await q.take(n)).map(hidePlant),
    paginate: async (opts: Any) => {
      const r = await q.paginate(opts)
      return { ...r, page: r.page.map(hidePlant) }
    },
    async *[Symbol.asyncIterator]() {
      for await (const d of q) yield hidePlant(d)
    },
  }
}

function lockedQuery(db: Any, table: string, plantId: string): Any {
  const raw = db.query(table)
  const base = () => wrapQuery(raw.withIndex('by_plant', (q: Any) => q.eq('plantId', plantId)))
  return {
    withIndex(name: string, range?: (q: Any) => Any) {
      if (name === 'by_plant') return base()
      return wrapQuery(
        raw.withIndex(name, (q: Any) => {
          const scoped = q.eq('plantId', plantId)
          return range ? range(scoped) : scoped
        }),
      )
    },
    withSearchIndex() {
      throw new Error('Search indexes are not plant-scoped yet')
    },
    fullTableScan: () => base(),
    order: (o: 'asc' | 'desc') => base().order(o),
    filter: (f: Any) => base().filter(f),
    collect: () => base().collect(),
    first: () => base().first(),
    unique: () => base().unique(),
    take: (n: number) => base().take(n),
    paginate: (opts: Any) => base().paginate(opts),
    [Symbol.asyncIterator]: () => base()[Symbol.asyncIterator](),
  }
}

/**
 * `db`: Convex veritabanı (query ya da mutation bağlamı). `tables`: şemadaki
 * tablo adları — kimliğin hangi tabloya ait olduğunu bulmak için.
 */
export function plantDb(db: Any, plantId: string, tables: readonly string[]): Any {
  const plantTables = tables.filter(isPlantTable)
  const tableOfId = (id: string): string | null => {
    for (const t of tables) if (db.normalizeId(t, id)) return t
    return null
  }
  /** Yeni imza (tablo, id, …) ile eski imza (id, …) ikisi de. */
  const split = (args: Any[]): { id: string; rest: Any[] } =>
    typeof args[0] === 'string' && tables.includes(args[0]) && args.length >= 2 && typeof args[1] === 'string' && db.normalizeId(args[0], args[1])
      ? { id: args[1], rest: args.slice(2) }
      : { id: args[0], rest: args.slice(1) }

  const visible = async (id: string) => {
    const doc = await db.get(id)
    if (!doc) return null
    if (doc.plantId === plantId) return doc
    if (doc.plantId !== undefined) return null
    const table = tableOfId(id)
    return table && isPlantTable(table) ? null : doc
  }
  const own = async (id: string) => {
    const doc = await visible(id)
    if (!doc) throw new ConvexError('Record not found')
    return doc
  }
  const strip = (value: Any) => {
    if (!value || typeof value !== 'object') return value
    const { plantId: _p, ...rest } = value
    return rest
  }

  return {
    query: (table: string) => (isPlantTable(table) ? lockedQuery(db, table, plantId) : db.query(table)),
    get: async (...args: Any[]) => hidePlant(await visible(split(args).id)),
    insert: (table: string, value: Any) => db.insert(table, isPlantTable(table) ? { ...strip(value), plantId } : value),
    patch: async (...args: Any[]) => {
      const { id, rest } = split(args)
      const doc = await own(id)
      return db.patch(id, doc.plantId === undefined ? rest[0] : strip(rest[0]))
    },
    replace: async (...args: Any[]) => {
      const { id, rest } = split(args)
      const doc = await own(id)
      // Kayıt handler'a plantId'siz döndüğü için yerine konan kayda yeniden eklenir.
      return db.replace(id, doc.plantId === undefined ? rest[0] : { ...strip(rest[0]), plantId })
    },
    delete: async (...args: Any[]) => {
      const { id } = split(args)
      await own(id)
      return db.delete(id)
    },
    normalizeId: (table: string, id: string) => db.normalizeId(table, id),
    system: db.system,
    /** Yalnızca test ve denetim için. */
    plantTables,
  }
}
