import { Link } from '@tanstack/react-router'
import { useConvex } from 'convex/react'
import { useEffect, useState } from 'react'

/**
 * Veritabanı bağlantısı kopuksa her sayfada uyarı gösterir.
 *
 * Bağlantı yokken sayfalar sadece boş görünür ve kullanıcı "veri kayboldu"
 * sanır. Oysa veri yerinde durur, sadece okunamıyordur — bu ayrımı yapmak
 * kritik. Kısa kopmalarda uyarı çıkmasın diye birkaç saniye beklenir.
 */
const GRACE_MS = 6000

export function ConnectionBanner() {
  const convex = useConvex()
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    const read = () => {
      const connected = convex.connectionState().isWebSocketConnected
      if (connected) {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        setOffline(false)
      } else if (timer === null) {
        timer = setTimeout(() => setOffline(true), GRACE_MS)
      }
    }

    read()
    const unsubscribe = convex.subscribeToConnectionState?.(read)
    const interval = setInterval(read, 2000)
    return () => {
      unsubscribe?.()
      clearInterval(interval)
      if (timer) clearTimeout(timer)
    }
  }, [convex])

  if (!offline) return null

  return (
    <div className="sticky top-[57px] z-40 border-b border-amber-300 bg-amber-100 px-6 py-2 text-sm text-amber-900">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <span>
          <strong>Veritabanına bağlanılamıyor.</strong> Bu sayfadaki veriler
          eksik veya güncel olmayabilir — verilerin silinmedi, sadece
          okunamıyor. Şu an yaptığın değişiklikler kaydedilmez.
        </span>
        <Link to="/tani" className="font-medium underline">
          Nedenini gör
        </Link>
      </div>
    </div>
  )
}
