// Convex'in ürettiği `convex/_generated` dosyaları yoksa (CI, yerel doğrulama)
// tip kontrolü ve testler için taslak yazar. Taslak, gerçek kod üretimi gibi
// veri modelini şemadan türetir (Doc, Id, DataModel; tipli query/mutation).
// Yalnızca `api` / `internal` gevşektir (anyApi). Gerçek dosyalar varsa
// (deploy'da `convex codegen` üretir) dokunmaz. Taslak commit'e girmez.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const dir = new URL('../convex/_generated/', import.meta.url)
if (['server.ts', 'server.js', 'server.d.ts'].some((f) => existsSync(new URL(f, dir)))) {
  console.log('convex/_generated exists — left as is')
  process.exit(0)
}
mkdirSync(dir, { recursive: true })
const files = {
  'api.ts': "import { anyApi } from 'convex/server'\nexport const api: any = anyApi\nexport const internal: any = anyApi\n",
  'dataModel.ts': `import type { DataModelFromSchemaDefinition, DocumentByName, TableNamesInDataModel } from 'convex/server'
import type { GenericId } from 'convex/values'
import schema from '../schema'
export type DataModel = DataModelFromSchemaDefinition<typeof schema>
export type TableNames = TableNamesInDataModel<DataModel>
export type Doc<T extends TableNames> = DocumentByName<DataModel, T>
export type Id<T extends TableNames> = GenericId<T>
`,
  'server.ts': `import {
  actionGeneric, httpActionGeneric, internalActionGeneric, internalMutationGeneric, internalQueryGeneric, mutationGeneric, queryGeneric,
  type ActionBuilder, type GenericActionCtx, type GenericMutationCtx, type GenericQueryCtx, type HttpActionBuilder, type MutationBuilder, type QueryBuilder,
} from 'convex/server'
import type { DataModel } from './dataModel'
export const query: QueryBuilder<DataModel, 'public'> = queryGeneric
export const internalQuery: QueryBuilder<DataModel, 'internal'> = internalQueryGeneric
export const mutation: MutationBuilder<DataModel, 'public'> = mutationGeneric
export const internalMutation: MutationBuilder<DataModel, 'internal'> = internalMutationGeneric
export const action: ActionBuilder<DataModel, 'public'> = actionGeneric
export const internalAction: ActionBuilder<DataModel, 'internal'> = internalActionGeneric
export const httpAction: HttpActionBuilder = httpActionGeneric
export type QueryCtx = GenericQueryCtx<DataModel>
export type MutationCtx = GenericMutationCtx<DataModel>
export type ActionCtx = GenericActionCtx<DataModel>
`,
}
for (const [name, body] of Object.entries(files)) writeFileSync(new URL(name, dir), body)
console.log('convex/_generated stub written (schema-typed)')
