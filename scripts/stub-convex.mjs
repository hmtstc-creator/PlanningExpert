// Convex'in ürettiği `convex/_generated` dosyaları yoksa (CI, yerel doğrulama)
// tip kontrolü ve testler için geçici taslak yazar. Gerçek dosyalar varsa
// (Vercel build'inde `convex codegen` üretir) dokunmaz. Taslak commit'e girmez.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const dir = new URL('../convex/_generated/', import.meta.url)
if (existsSync(new URL('server.ts', dir)) || existsSync(new URL('server.js', dir)) || existsSync(new URL('server.d.ts', dir))) {
  console.log('convex/_generated exists — left as is')
  process.exit(0)
}
mkdirSync(dir, { recursive: true })
writeFileSync(
  new URL('api.ts', dir),
  "import { anyApi } from 'convex/server'\nexport const api: any = anyApi\nexport const internal: any = anyApi\n",
)
writeFileSync(
  new URL('server.ts', dir),
  [
    "import type { GenericMutationCtx, GenericQueryCtx } from 'convex/server'",
    'export { queryGeneric as query, mutationGeneric as mutation, actionGeneric as action, internalQueryGeneric as internalQuery, internalMutationGeneric as internalMutation, internalActionGeneric as internalAction, httpActionGeneric as httpAction } from \'convex/server\'',
    'export type QueryCtx = GenericQueryCtx<any>',
    'export type MutationCtx = GenericMutationCtx<any>',
    '',
  ].join('\n'),
)
console.log('convex/_generated stub written')
