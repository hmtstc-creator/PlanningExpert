import { useMutation } from './convexTransport'
import { useCallback, useState } from 'react'

/**
 * Convex mutation'larını hata yutmadan çağırmak için.
 *
 * `void mutate(...)` şeklindeki çağrılarda sunucu hatası sessizce kaybolur;
 * kullanıcı kaydettiğini sanır ama veri yazılmamıştır. Bu sarmalayıcı hatayı
 * yakalar, ekranda gösterilebilecek bir mesaja çevirir ve çağrının başarılı
 * olup olmadığını `true`/`false` olarak döner.
 */
export function useSafeMutation<Mutation extends Parameters<typeof useMutation>[0]>(
  mutation: Mutation,
) {
  const mutate = useMutation(mutation)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const run = useCallback(
    async (args: unknown): Promise<boolean> => {
      setPending(true)
      setError(null)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (mutate as any)(args)
        return true
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setPending(false)
      }
    },
    [mutate],
  )

  return { run, error, pending, clearError: useCallback(() => setError(null), []) }
}
