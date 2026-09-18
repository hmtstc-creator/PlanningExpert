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
    <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 sm:px-6">
      <div className="flex w-full flex-wrap items-center gap-2">
        <span>
          <strong>Fallback connection mode.</strong> The live connection (WebSocket) could not
          be established, so data is fetched over HTTPS at regular intervals.
          Saving works; changes appear on other devices after a short delay.
        </span>
        <Link to="/tani" className="font-medium underline">
          See why
        </Link>
      </div>
    </div>
  )
}
