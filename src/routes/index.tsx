import { createFileRoute, Link } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { useMemo } from 'react'

import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const { results: products } = usePaginatedQuery(api.products.list, {}, { initialNumItems: 300 })
  const { results: weekly } = usePaginatedQuery(api.demand.listWeekly, {}, { initialNumItems: 300 })
  const { results: stockRows } = usePaginatedQuery(api.stock.list, {}, { initialNumItems: 500 })
  const { results: locations } = usePaginatedQuery(api.storageLocations.list, {}, { initialNumItems: 100 })
  const calendar = useQuery(api.workCalendar.get)

  const locCategory = useMemo(
    () => new Map(locations.map((l) => [l.code, l.category])),
    [locations],
  )

  const availableStock = useMemo(() => {
    let total = 0
    for (const s of stockRows) {
      const cat = s.storageLocation ? locCategory.get(s.storageLocation) ?? 'available' : 'available'
      if (cat === 'available') total += s.unrestricted ?? 0
    }
    return total
  }, [stockRows, locCategory])

  const productCodes = useMemo(() => new Set(products.map((p) => p.code)), [products])

  const warnings = useMemo(() => {
    const list: { level: 'high' | 'medium'; text: string; link?: string }[] = []

    const missingMachine = products.filter((p) => !p.mainMachine || !p.mainMachine.trim())
    if (missingMachine.length > 0) {
      list.push({
        level: 'high',
        text: `${missingMachine.length} referansta ana makine bilgisi eksik — bunlar planlanamıyor.`,
        link: '/referanslar',
      })
    }

    const unknownMaterials = weekly.filter((w) => !productCodes.has(w.material))
    if (unknownMaterials.length > 0) {
      list.push({
        level: 'medium',
        text: `Siparişlerde ${unknownMaterials.length} materyalin kalıp/makine kaydı yok — planlamada atlanır.`,
        link: '/referanslar',
      })
    }

    const undefinedLocs = new Set<string>()
    for (const s of stockRows) {
      if (s.storageLocation && !locCategory.has(s.storageLocation)) undefinedLocs.add(s.storageLocation)
    }
    if (undefinedLocs.size > 0) {
      list.push({
        level: 'medium',
        text: `${undefinedLocs.size} depo yeri henüz tanımlanmadı — varsayılan olarak stok sayılıyor.`,
        link: '/depolar',
      })
    }

    if (!calendar) {
      list.push({
        level: 'medium',
        text: 'Çalışma takvimi tanımlanmadı — süreler varsayılan 8 saat/gün üzerinden hesaplanıyor.',
        link: '/takvim',
      })
    }

    const overdueCount = weekly.filter((w) => (w.overdue ?? 0) < 0).length
    if (overdueCount > 0) {
      list.push({
        level: 'high',
        text: `${overdueCount} materyalde gecikmiş sipariş var.`,
        link: '/siparisler',
      })
    }

    return list
  }, [products, weekly, stockRows, locCategory, calendar, productCodes])

  const dataReady = products.length > 0 && weekly.length > 0 && stockRows.length > 0

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Üretim Planlama</h1>
      <p className="mt-2 text-muted-foreground">
        Preshane üretim planlama sistemi — günlük durum özeti
      </p>

      <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Tanımlı referans" value={products.length} hint="kalıp/makine kaydı olan" to="/referanslar" />
        <StatCard label="Talep kaydı" value={weekly.length} hint="ZPP materyali" to="/siparisler" />
        <StatCard
          label="Kullanılabilir stok"
          value={availableStock.toLocaleString('tr-TR')}
          hint="planlamaya dahil depolar"
          to="/stoklar"
        />
        <StatCard
          label="Uyarı"
          value={warnings.length}
          hint={warnings.some((w) => w.level === 'high') ? 'kritik var' : 'kontrol et'}
          to="/depolar"
          danger={warnings.some((w) => w.level === 'high')}
        />
      </div>

      {warnings.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold text-foreground">Dikkat edilmesi gerekenler</h2>
          <div className="mt-3 space-y-2">
            {warnings.map((w, i) => (
              <Link
                key={i}
                to={w.link ?? '/'}
                className={`flex items-start gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/40 ${
                  w.level === 'high' ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                <span className="mt-0.5">{w.level === 'high' ? '🔴' : '🟡'}</span>
                <span>{w.text}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-semibold text-foreground">Günlük akış</h2>
        <ol className="mt-3 space-y-2">
          <StepItem n={1} done={weekly.length > 0} title="SAP verilerini yükle" desc="ZPP ve ZPP_DAILY → Siparişler, MB52 → Stoklar" to="/siparisler" />
          <StepItem n={2} done={locations.length > 0} title="Depo tanımlarını kontrol et" desc="Hangi stok gerçekten elimizde?" to="/depolar" />
          <StepItem n={3} done={!!calendar} title="Çalışma takvimini doğrula" desc="Vardiya, çalışma günleri, tatiller" to="/takvim" />
          <StepItem n={4} done={false} title="Planı oluştur" desc="ZPP'den otomatik doldur → makine ataması ve sıralama" to="/planlama" />
        </ol>
      </section>

      {!dataReady && (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Sistemin tam çalışması için üç veri seti de gerekli: referanslar, ZPP talep verisi ve MB52 stok verisi.
        </p>
      )}
    </div>
  )
}

function StatCard({ label, value, hint, to, danger }: { label: string; value: number | string; hint: string; to: string; danger?: boolean }) {
  return (
    <Link to={to} className={`rounded-lg border p-4 transition-colors hover:bg-muted/40 ${danger ? 'border-red-200 bg-red-50' : 'border-border'}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${danger ? 'text-red-700' : 'text-foreground'}`}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </Link>
  )
}

function StepItem({ n, done, title, desc, to }: { n: number; done: boolean; title: string; desc: string; to: string }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}`}>
          {done ? '✓' : n}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">{title}</span>
          <span className="block text-xs text-muted-foreground">{desc}</span>
        </span>
      </Link>
    </li>
  )
}
