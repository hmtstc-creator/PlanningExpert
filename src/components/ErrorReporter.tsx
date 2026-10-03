import { useEffect } from 'react'

import { api } from '../../convex/_generated/api'
import { useMutation } from '../lib/convexTransport'
import { usePlant } from '../lib/plantContext'
import { shouldReport } from '../lib/errorReport'

/**
 * Yakalanmamış ekran hatalarını platform hata kaydına gönderir
 * (convex/errors.ts). Sayfa başına sınırlı; gönderim hatası yutulur — hata
 * kaydı yüzünden ikinci bir hata çıkmasın.
 */
export function ErrorReporter() {
  const report = useMutation(api.errors.report)
  const plant = usePlant().ctx?.active?.plantName
  useEffect(() => {
    const send = (message: string, stack?: string) => {
      if (!shouldReport(message)) return
      void Promise.resolve(report({ message, stack, url: window.location.pathname, plant })).catch(() => {})
    }
    const onError = (e: ErrorEvent) => send(e.message || String(e.error), e.error instanceof Error ? e.error.stack : undefined)
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason
      // Kural hatası (ConvexError, `data` taşır) kayda gitmez.
      if (r && typeof r === 'object' && 'data' in r) return
      send(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [report, plant])
  return null
}

/** ErrorBoundary'den (sayfa çöktü) tek seferlik gönderim. */
export function useReportCrash(error: unknown) {
  const report = useMutation(api.errors.report)
  useEffect(() => {
    const message = error instanceof Error ? error.message : String(error)
    if (!shouldReport(message)) return
    void Promise.resolve(
      report({ message: `Page crashed: ${message}`, stack: error instanceof Error ? error.stack : undefined, url: window.location.pathname }),
    ).catch(() => {})
  }, [error, report])
}
