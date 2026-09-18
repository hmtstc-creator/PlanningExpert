import { ConvexAuthProvider } from '@convex-dev/auth/react'
import { ConvexReactClient } from 'convex/react'

import { reportMutationError } from '../lib/mutationErrors'
import { TransportProvider } from '../lib/convexTransport'

const CONVEX_URL = (import.meta as any).env.VITE_CONVEX_URL
if (!CONVEX_URL) {
  console.error('missing envar VITE_CONVEX_URL')
}
const convex = new ConvexReactClient(CONVEX_URL)

// Sayfalar mutation'ları çoğu yerde `void mutate(...)` ile çağırıyor; bu
// durumda sunucu hatası sessizce kaybolur ve kullanıcı kaydettiğini sanır.
// İstemciyi sarmalayıp her hatayı merkezi bildirim kanalına aktarıyoruz.
const originalMutation = convex.mutation.bind(convex)
convex.mutation = ((...args: Parameters<typeof originalMutation>) => {
  const promise = originalMutation(...args)
  void promise.catch((error: unknown) => reportMutationError(error))
  return promise
}) as typeof convex.mutation

export default function AppConvexProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ConvexAuthProvider client={convex}>
      <TransportProvider>{children}</TransportProvider>
    </ConvexAuthProvider>
  )
}
