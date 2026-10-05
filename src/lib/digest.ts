// Günlük özet e-postası: Today sinyallerinin seçilen alıcılara, seçilen gün
// ve saatte gönderilmesi (Company settings → Today & daily digest).
//
// Saf kurallar: ne zaman gönderilir, hangi sinyaller girer, e-postanın metni.
// Gönderen sunucu: convex/digest.ts (her 15 dakikada bir bakar).

import { signalType, type Signal } from './cockpit'

export interface DigestConfig {
  enabled: boolean
  /** Plant saatine göre "HH:MM". */
  time: string
  /** 'MO' … 'SU'. */
  days: string[]
  to: string[]
  cc: string[]
  /** SIGNAL_TYPES anahtarları; boşsa hepsi. */
  signals: string[]
  /** Yalnızca kritik/uyarı varsa gönder (hepsi yolundaysa e-posta yok). */
  onlyWhenIssues: boolean
}

export const DAY_KEYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
export const DAY_LABELS: Record<string, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' }

/** Yeni kurulumun başlangıç hâli: kapalı, alıcısız — kullanıcı açar. */
export const EMPTY_DIGEST: DigestConfig = { enabled: false, time: '07:00', days: [], to: [], cc: [], signals: [], onlyWhenIssues: false }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const validEmail = (s: string) => EMAIL.test(s.trim())

/** Ayarın sorunları (kaydetmeden önce; sunucu da aynısını denetler). */
export function digestProblems(c: DigestConfig): string[] {
  const out: string[] = []
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.time)) out.push('Time must be HH:MM (00:00–23:59)')
  for (const a of [...c.to, ...c.cc]) if (!validEmail(a)) out.push(`Not an email address: ${a}`)
  if (c.enabled && c.to.length === 0) out.push('Add at least one recipient')
  if (c.enabled && c.days.length === 0) out.push('Choose at least one day')
  return out
}

/** Plant saatinde şu an: tarih, gün anahtarı ve gece yarısından dakika. */
export function localNow(now: number, timeZone: string): { date: string; day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date(now))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const day = { Mon: 'MO', Tue: 'TU', Wed: 'WE', Thu: 'TH', Fri: 'FR', Sat: 'SA', Sun: 'SU' }[get('weekday')] ?? 'MO'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, day, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

/**
 * Bugün gönderilmeli mi? Seçili gün, saat geldi, bugün henüz gönderilmedi.
 * Saat geçtikten sonra da (sunucu o anda kapalıysa) aynı gün içinde gider.
 */
export function digestDue(c: DigestConfig, local: { date: string; day: string; minutes: number }, lastSentDate?: string): boolean {
  if (!c.enabled || c.to.length === 0 || !c.days.includes(local.day)) return false
  if (lastSentDate === local.date) return false
  const [h, m] = c.time.split(':').map(Number)
  return local.minutes >= h * 60 + m
}

/** Özete girecek sinyaller: seçilen türler (boş = hepsi). */
export function digestSignals(signals: Signal[], c: Pick<DigestConfig, 'signals'>): Signal[] {
  return c.signals.length ? signals.filter((s) => c.signals.includes(signalType(s.key))) : signals
}

export const hasIssues = (signals: Signal[]) => signals.some((s) => s.level !== 'ok')

const MARK: Record<Signal['level'], string> = { critical: '[CRITICAL]', warning: '[WARNING]', ok: '[OK]' }

/** E-postanın konusu ve metni (düz metin ve basit HTML). */
export function composeDigest(
  plant: { company: string; plant: string },
  signals: Signal[],
  opts: { date: string; appUrl?: string },
): { subject: string; text: string; html: string } {
  const critical = signals.filter((s) => s.level === 'critical').length
  const warning = signals.filter((s) => s.level === 'warning').length
  const head = critical || warning ? [critical && `${critical} critical`, warning && `${warning} warning${warning === 1 ? '' : 's'}`].filter(Boolean).join(', ') : 'all clear'
  const subject = `${plant.plant} — Today ${opts.date}: ${head}`
  const link = (to: string) => (opts.appUrl ? `${opts.appUrl.replace(/\/$/, '')}${to}` : '')

  const text = [
    `${plant.company} · ${plant.plant} — what needs a decision today (${opts.date})`,
    '',
    ...(signals.length ? [] : ['Nothing to report.']),
    ...signals.flatMap((s) => [
      `${MARK[s.level]} ${s.title}`,
      ...(s.detail ? [`  ${s.detail}`] : []),
      ...(s.items ?? []).map((i) => `  - ${i.text}${i.sub ? ` (${i.sub})` : ''}`),
      ...(link(s.to) ? [`  ${link(s.to)}`] : []),
      '',
    ]),
    '—',
    'Sent by the Production Portal. Change recipients and contents on Company settings → Today & daily digest.',
  ].join('\n')

  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const color: Record<Signal['level'], string> = { critical: '#b91c1c', warning: '#b45309', ok: '#047857' }
  const html = [
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">`,
    `<p style="margin:0 0 12px"><b>${esc(plant.company)} · ${esc(plant.plant)}</b> — what needs a decision today (${esc(opts.date)})</p>`,
    ...(signals.length ? [] : ['<p>Nothing to report.</p>']),
    ...signals.map(
      (s) =>
        `<div style="border-left:4px solid ${color[s.level]};padding:4px 10px;margin:0 0 10px">` +
        `<div style="font-weight:bold;color:${color[s.level]}">${esc(s.title)}</div>` +
        (s.detail ? `<div style="color:#555">${esc(s.detail)}</div>` : '') +
        ((s.items ?? []).length
          ? `<ul style="margin:4px 0 0;padding-left:18px">${(s.items ?? []).map((i) => `<li>${esc(i.text)}${i.sub ? ` <span style="color:#666">— ${esc(i.sub)}</span>` : ''}</li>`).join('')}</ul>`
          : '') +
        (link(s.to) ? `<div><a href="${esc(link(s.to))}">Open</a></div>` : '') +
        `</div>`,
    ),
    `<p style="color:#888;font-size:12px">Sent by the Production Portal. Change recipients and contents on Company settings → Today &amp; daily digest.</p>`,
    `</div>`,
  ].join('')
  return { subject, text, html }
}
