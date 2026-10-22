/**
 * Yayındaki sürüm: release.sh site derlemesinden hemen önce git'ten okuyup
 * VITE_BUILD_* olarak gömer (planlamacı, 2026-10-22: "yayındaki site en güncel
 * hali mi?" Connection diagnostics'te görünsün). Yerel geliştirmede boştur.
 */
const env = ((import.meta as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>

export interface BuildInfo {
  /** Kısa commit (ör. fb6b711); yoksa boş. */
  commit: string
  /** Commit başlığı (ilk satır). */
  message: string
  /** Commit zamanı (ISO). */
  committedAt: string
  /** Derleme / yayın zamanı (ISO, UTC). */
  builtAt: string
  /** Dal (ör. main). */
  branch: string
}

export const BUILD: BuildInfo = {
  commit: env.VITE_BUILD_COMMIT ?? '',
  message: env.VITE_BUILD_MESSAGE ?? '',
  committedAt: env.VITE_BUILD_COMMITTED_AT ?? '',
  builtAt: env.VITE_BUILD_TIME ?? '',
  branch: env.VITE_BUILD_BRANCH ?? '',
}

export const REPO_URL = 'https://github.com/hmtstc-creator/PlanningExpert'

/** "22 Oct 2026, 07:28 UTC · 10:28 Türkiye" */
export function formatBuildTime(iso: string): string {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return '—'
  const fmt = (timeZone: string) =>
    d.toLocaleString('en-GB', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return `${fmt('UTC')} UTC · ${fmt('Europe/Istanbul')} Türkiye`
}
