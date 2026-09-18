// Uygulama genelinde Convex mutation hatalarını toplayan küçük bir yayın
// kanalı. Sayfalar `void mutate(...)` şeklinde çağırdığında hata sessizce
// kaybolurdu; artık her hata buradan geçip ekranda görünür.

type Listener = (message: string) => void

const listeners = new Set<Listener>()

export function reportMutationError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  for (const l of listeners) l(message)
}

export function onMutationError(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
