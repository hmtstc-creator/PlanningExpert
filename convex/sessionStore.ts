import type { Doc } from './_generated/dataModel'
import { sha256Hex } from '../src/lib/sha256'

/**
 * Oturum jetonu veritabanında açık durmaz: `sessions.token` alanında jetonun
 * SHA-256 karması ("h:" önekiyle) saklanır. Veritabanı ya da yedek dosyası
 * ele geçse bile oradaki değerle oturum açılamaz — tarayıcıdaki jeton
 * karmadan geri üretilemez.
 *
 * Geçiş: bu değişiklikten önce açılmış oturumlar jetonu açık tutuyor; süreleri
 * dolana kadar (en çok SESSION_TTL_MS) aynen çalışırlar, kimse atılmaz.
 */
export const tokenKey = (token: string) => `h:${sha256Hex(token)}`


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function findSession(db: any, token: string | undefined): Promise<Doc<'sessions'> | null> {
  // Veritabanındaki karma ("h:…") jeton yerine kullanılamaz: sızan bir yedekteki
  // değerle oturum açılmasın.
  if (!token || token.startsWith('h:')) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byKey = (key: string) => db.query('sessions').withIndex('by_token', (q: any) => q.eq('token', key)).first()
  // Önce karma; yoksa eski (karmasız) oturum.
  return (await byKey(tokenKey(token))) ?? (await byKey(token))
}

/** Bu oturum kaydı bu jetonun mu? (yeni: karma, eski: açık jeton) */
export const sessionMatches = (stored: string, token: string) => stored === tokenKey(token) || stored === token
