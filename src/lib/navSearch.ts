// Komut paletinin (Ctrl+K) sayfa dizini ve araması. Saf: menü verisinden
// (navigation.ts) kurulur, izin süzgeci çağırandadır (useCanOpen).
//
// Ekran İngilizce, kullanıcılar çoğunlukla Türkçe düşünür: her sayfaya
// Türkçe ve SAP karşılıkları anahtar kelime olarak eklendi ("arıza",
// "kalıp", "MB52" …). Arama Türkçe harflerden bağımsızdır (ı = i, ş = s …).

import { ACCOUNT_LINKS, BOARD_AREA, MODULE_AREAS, SETTINGS_AREA, type AccentKey, type Area, type IconKey, type NavNode } from './navigation'

export interface PageEntry {
  to: string
  label: string
  hint?: string
  icon: IconKey
  accent: AccentKey
  /** Modül ya da bölüm adı (sonuçta sağda görünür). */
  section: string
  /** Menüdeki grup (ör. "Master data"). */
  group?: string
}

/** Sayfa başına arama kelimeleri (Türkçe, SAP kodları, eş anlamlılar). */
export const PAGE_KEYWORDS: Record<string, string> = {
  '/planlama': 'plan üretim planı gantt schedule çizelge haftalık',
  '/planningexpert': 'genel bakış özet durum uyarı overview',
  '/capacity': 'kapasite doluluk yük load iş merkezi grubu',
  '/hammadde': 'hammadde sac çelik steel coil bobin malzeme ihtiyacı',
  '/alarms': 'alarm uyarı darboğaz bottleneck',
  '/performans': 'performans plan gerçekleşen uyum adherence',
  '/sapdata': 'sap yükleme upload excel zpp zpp_daily mb52 mb51',
  '/siparisler': 'talep sipariş ihtiyaç demand order zpp net',
  '/stoklar': 'stok envanter depo mb52 inventory',
  '/gerceklesen': 'gerçekleşen üretim hareket mb51 actual posting',
  '/referanslar': 'ana veri referans parça malzeme kalıp göz cavity spm ağırlık part',
  '/makineler': 'iş merkezi makine pres hat hall salon kategori work center',
  '/takvim': 'takvim vardiya tatil duruş mesai shift calendar',
  '/depolar': 'depo yer lokasyon storage location',
  '/planlogic': 'plan mantığı nasıl hesaplanır kural yardım help',
  '/kayitlar': 'karar kayıt kural açık konu decision log',
  '/oee': 'oee verimlilik ekipman etkinliği dashboard',
  '/oee/losses': 'kayıp duruş loss trend kalıp arıza setup',
  '/oee/bridge': 'kayıp köprüsü bridge şelale waterfall teep oee kayıp öncelik pareto level',
  '/oee/data': 'oee veri tablo yükleme',
  '/oee/settings': 'oee ayar bölüm vardiya kayıp grubu',
  '/oee/guide': 'oee kılavuz nasıl kullanılır rehber',
  '/die-followup': 'kalıp takip die genel',
  '/die-followup/problems': 'kalıp problem sorun hata çapak yırtık zımba',
  '/die-followup/maintenance': 'kalıp bakım hazır vuruş sayacı shot limit',
  '/die-followup/reports': 'kalıp rapor pareto',
  '/machine-followup': 'makine takip genel',
  '/machine-followup/breakdowns': 'arıza makine duruş breakdown bozuk',
  '/machine-followup/maintenance': 'makine bakım planlı periyodik',
  '/machine-followup/reports': 'makine arıza rapor pareto',
  '/kpi': 'kpi gösterge hedef',
  '/kpi/monthly/entry': 'kpi aylık giriş veri',
  '/kpi/weekly/entry': 'kpi haftalık giriş veri',
  '/kpi/monthly/dashboard': 'kpi aylık a3 rapor pdf',
  '/kpi/weekly/dashboard': 'kpi haftalık a3 rapor pdf',
  '/board': 'yönetim kurulu board grup holding özet',
  '/settings': 'şirket ayar fabrika plant bölüm masraf yeri cost center liste',
  '/users': 'kullanıcı yetki izin grup rol permission',
  '/admin': 'yönetim holding şirket general güvenlik security',
  '/account': 'hesabım parola şifre cihaz oturum',
  '/compare': 'fabrika karşılaştır plant compare',
  '/tani': 'bağlantı teşhis internet diagnostics',
}

/** Türkçe harfler ve büyük/küçük farkı olmadan karşılaştırma için. */
export function fold(s: string): string {
  return s
    .replace(/İ/g, 'i')
    .replace(/I/g, 'i')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function walk(nodes: NavNode[], a: Area, group: string | undefined, out: PageEntry[]) {
  for (const n of nodes) {
    if (n.to) out.push({ to: n.to, label: n.label, hint: n.hint, icon: n.icon ?? a.icon, accent: a.accent, section: a.title, group })
    if (n.children) walk(n.children, a, n.to ? group : n.label === 'Menu' ? group : n.label, out)
  }
}

/** Bütün sayfalar, her biri bir kez (modül menüsündeki yeri önce gelir). */
export function pageIndex(): PageEntry[] {
  const out: PageEntry[] = []
  for (const a of [...MODULE_AREAS, BOARD_AREA, SETTINGS_AREA]) walk(a.nav, a, undefined, out)
  for (const l of ACCOUNT_LINKS)
    out.push({ to: l.to, label: l.label, hint: l.hint, icon: l.icon ?? 'user', accent: 'slate', section: 'Account' })
  const seen = new Set<string>()
  return out.filter((p) => !seen.has(p.to) && seen.add(p.to))
}

/**
 * Arama: her kelime sayfanın bir yerinde geçmeli. Ad başında geçen önce,
 * sonra ad içinde, modül / grup, sayfanın ilk anahtar kelimesi (asıl
 * Türkçe adı), sonra açıklama ve diğer anahtar kelimeler.
 */
export function searchPages(index: PageEntry[], query: string, limit = 12): PageEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: { p: PageEntry; score: number }[] = []
  for (const p of index) {
    const label = fold(p.label)
    const section = fold(`${p.section} ${p.group ?? ''}`)
    const keywords = fold(PAGE_KEYWORDS[p.to] ?? '')
    const rest = fold(`${p.hint ?? ''} ${keywords} ${p.to}`)
    let score = 0
    let all = true
    for (const w of words) {
      const s = label.startsWith(w)
        ? 40
        : new RegExp(`(^|[\\s/&-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)
          ? 30
          : label.includes(w)
            ? 20
            : section.includes(w)
              ? 12
              : keywords.startsWith(w)
                ? 10
                : rest.includes(w)
                  ? 8
                  : 0
      if (!s) {
        all = false
        break
      }
      score += s
    }
    if (all) scored.push({ p, score: score - p.label.length / 100 })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p)
}
