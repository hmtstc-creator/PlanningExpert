import { Link } from '@tanstack/react-router'

import { useTransport } from '../lib/convexTransport'

/**
 * Bağlantı durumunu her sayfada gösterir.
 *
 * - WebSocket çalışıyorsa hiçbir şey görünmez.
 * - WebSocket engelliyse uygulama HTTPS'e düşer: veri gelir ama canlı
 *   değildir; bunu kullanıcıya söylemek gerekir.
 * - Hiçbiri çalışmıyorsa veri okunamıyor demektir — "veri silindi"
 *   sanılmasın diye açıkça yazılır.
 */
export function ConnectionBanner() {
  const { mode } = useTransport()

  if (mode === 'websocket' || mode === 'connecting') return null

  return (
    <div className="sticky top-[57px] z-40 border-b border-amber-300 bg-amber-100 px-6 py-2 text-sm text-amber-900">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <span>
          <strong>Yedek bağlantı modu.</strong> Canlı bağlantı (WebSocket)
          kurulamadı, veriler HTTPS üzerinden düzenli aralıklarla çekiliyor.
          Kaydetme çalışır; değişiklikler diğer cihazlarda birkaç saniye
          gecikmeli görünür.
        </span>
        <Link to="/tani" className="font-medium underline">
          Nedenini gör
        </Link>
      </div>
    </div>
  )
}
