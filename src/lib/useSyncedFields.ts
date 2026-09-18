import { useEffect, useRef } from 'react'

import { changedFields } from './syncedFields'

/**
 * Sunucu verisini form alanlarına yansıtır, ama yalnızca sunucudaki değer
 * gerçekten değiştiğinde. Ayrıntılı gerekçe için `syncedFields.ts`.
 *
 * @param incoming Sunucudan gelen değerler; veri henüz yoksa undefined.
 * @param setters Her alan için state setter'ı.
 */
export function useSyncedFields<T extends Record<string, unknown>>(
  incoming: T | undefined,
  setters: { [K in keyof T]: (value: T[K]) => void },
): void {
  const previous = useRef<T | null>(null)
  // Setter'lar her render'da yeniden oluşabilir; efekt onlara bağlı olmasın.
  const settersRef = useRef(setters)
  settersRef.current = setters

  const signature = incoming ? JSON.stringify(incoming) : null

  useEffect(() => {
    if (!incoming) return
    const keys = changedFields(previous.current, incoming)
    previous.current = incoming
    for (const key of keys) {
      settersRef.current[key]?.(incoming[key])
    }
    // Değerlerin kendisi değişmediyse efekt tekrar çalışmasın diye
    // imzaya bağlanıyoruz — sorgu her tazelendiğinde yeni nesne gelir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
}
