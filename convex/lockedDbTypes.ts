/**
 * Fabrikaya kilitli veritabanının (convex/plantDb.ts) tipi.
 *
 * Çalışma zamanı plantDb'dir: fabrika tablolarında her sorgu `plantId = aktif
 * fabrika` ile başlar, eklemeye `plantId` konur. Tip de bunu bilir: fabrika
 * tablosunda indeks aralığı `plantId`'siz, ikinci alandan başlar; platform
 * tablolarında (PLATFORM_TABLES) ilk alandan. Böylece tablo, alan ve indeks
 * adları derlemede denetlenir.
 */
import type {
  DocumentByInfo,
  DocumentByName,
  IndexNames,
  IndexRange,
  IndexRangeBuilder,
  NamedIndex,
  NamedTableInfo,
  Query,
  WithoutSystemFields,
} from 'convex/server'
import type { GenericId } from 'convex/values'

import type { DataModel, TableNames } from './_generated/dataModel'

/** convex/plantDb.ts → PLATFORM_TABLES ile aynı liste (test denetler). */
export type PlatformTable =
  | 'companies'
  | 'holdings'
  | 'plants'
  | 'userGroups'
  | 'platformState'
  | 'users'
  | 'sessions'
  | 'auditLog'
  | 'errorLog'
  | 'officialHolidays'

type TI<T extends TableNames> = NamedTableInfo<DataModel, T>
/** İndeksin ilk serbest alanı: fabrika tablosunda plantId kilitte dolu. */
type FirstField<T extends TableNames> = T extends PlatformTable ? 0 : 1

export interface LockedQueryInitializer<T extends TableNames> extends Query<TI<T>> {
  withIndex<I extends IndexNames<TI<T>>>(
    indexName: I,
    indexRange?: (q: IndexRangeBuilder<DocumentByInfo<TI<T>>, NamedIndex<TI<T>, I>, FirstField<T>>) => IndexRange,
  ): Query<TI<T>>
}

export type Doc<T extends TableNames> = DocumentByName<DataModel, T>

export interface LockedDb {
  query<T extends TableNames>(table: T): LockedQueryInitializer<T>
  get<T extends TableNames>(id: GenericId<T>): Promise<Doc<T> | null>
  insert<T extends TableNames>(table: T, value: WithoutSystemFields<Doc<T>>): Promise<GenericId<T>>
  patch<T extends TableNames>(id: GenericId<T>, value: Partial<Doc<T>>): Promise<void>
  replace<T extends TableNames>(id: GenericId<T>, value: WithoutSystemFields<Doc<T>>): Promise<void>
  delete(id: GenericId<TableNames>): Promise<void>
  normalizeId<T extends TableNames>(table: T, id: string): GenericId<T> | null
}
