import { useEffect, useState } from 'react'

import { onMutationError } from '../lib/mutationErrors'

/**
 * Sunucuya yazma sırasında oluşan hataları ekranda gösterir. Sessiz kayıt
 * hatası (kullanıcı kaydettiğini sanır ama veri yazılmamıştır) bu sayede
 * fark edilir.
 */
export function MutationErrorToast() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => onMutationError(setMessage), [])

  if (!message) return null

  return (
    <div className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-lg rounded-lg border border-destructive/40 bg-background p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-destructive">Kaydedilemedi</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Veri sunucuya yazılmadı. Bağlantını kontrol et; sorun sürerse
            Ayarlar → Bağlantı Teşhisi sayfasına bak.
          </p>
        </div>
        <button
          onClick={() => setMessage(null)}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        >
          Kapat
        </button>
      </div>
    </div>
  )
}
