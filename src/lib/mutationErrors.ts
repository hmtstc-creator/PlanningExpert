// Uygulama genelinde Convex mutation hatalarını toplayan küçük bir yayın
// kanalı. Sayfalar `void mutate(...)` şeklinde çağırdığında hata sessizce
// kaybolurdu; artık her hata buradan geçip ekranda görünür.
//
// Hata kullanıcıya teknik metinle ("[CONVEX M(...)] [Request ID …] Server
// Error Uncaught Error: …") gösterilmez: `friendlyError` yalnızca sebebi
// bırakır ve bunun bir kural mı (girişi düzelt) yoksa sunucu/bağlantı sorunu
// mu olduğunu söyler.

export interface FriendlyError {
  /** Kullanıcının okuyacağı cümle. */
  message: string
  /** 'rule' = giriş bir kurala takıldı; 'server' = sunucuya/bağlantıya ulaşılamadı. */
  kind: 'rule' | 'server'
}

export function friendlyError(error: unknown): FriendlyError {
  // ConvexError: sunucunun kullanıcıya verdiği mesaj `data`dadır.
  const data = (error as { data?: unknown } | null)?.data
  if (typeof data === 'string' && data.trim()) return { message: data.trim(), kind: 'rule' }
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const uncaught = raw.match(/Uncaught (?:ConvexError|Error):\s*([\s\S]*)/)
  if (uncaught) {
    const message = uncaught[1]
      .replace(/\s+at [\s\S]*$/, '')
      .replace(/\s*Called by client\s*$/, '')
      .trim()
    if (message) return { message, kind: 'rule' }
  }
  if (/\[CONVEX|Server Error|Failed to fetch|NetworkError|network|timed out/i.test(raw)) {
    return {
      message: 'The server could not save this change. Try again; if it repeats, check the connection.',
      kind: 'server',
    }
  }
  return { message: raw.trim() || 'Could not save', kind: raw.trim() ? 'rule' : 'server' }
}

type Listener = (error: FriendlyError) => void

const listeners = new Set<Listener>()

export function reportMutationError(error: unknown): void {
  const friendly = friendlyError(error)
  for (const l of listeners) l(friendly)
}

export function onMutationError(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
