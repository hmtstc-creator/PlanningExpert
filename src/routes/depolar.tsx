import { createFileRoute } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/depolar')({
  component: DepolarPage,
})

// Bu değerler planlama.tsx'teki COUNTED_CATEGORIES ile birebir eşleşmeli.
const CATEGORIES = [
  {
    value: 'finished_goods',
    label: 'Mamul Deposu (Finish Good)',
    hint: 'Bitmiş ürün — üretim ihtiyacından düşülür.',
    color: 'bg-emerald-100 text-emerald-800',
  },
  {
    value: 'production_area',
    label: 'Üretim Alanı (Production Area)',
    hint: 'Üretimdeki/WIP stok — üretim ihtiyacından düşülür.',
    color: 'bg-teal-100 text-teal-800',
  },
  {
    value: 'raw_material',
    label: 'Hammadde Deposu (Raw Material)',
    hint: 'Hammadde — mamul stok sayılmaz, üretim ihtiyacından düşülmez.',
    color: 'bg-slate-200 text-slate-700',
  },
  {
    value: 'quality',
    label: 'Kalite (Quality)',
    hint: 'Kalite kontrol bekliyor — henüz kullanılabilir sayılmaz.',
    color: 'bg-amber-100 text-amber-800',
  },
  {
    value: 'customer',
    label: 'Müşteri (Customer)',
    hint: 'Müşteriye transfer edilmiş/satılmış — stok sayılmaz.',
    color: 'bg-slate-200 text-slate-700',
  },
]

const DEFAULT_CATEGORY = 'finished_goods'

function DepolarPage() {
  const { results: locations } = usePaginatedQuery(
    api.storageLocations.list,
    {},
    { initialNumItems: 100 },
  )
  const { results: stockRows } = usePaginatedQuery(
    api.stock.list,
    {},
    { initialNumItems: 500 },
  )
  const upsert = useMutation(api.storageLocations.upsert)

  const [saving, setSaving] = useState<string | null>(null)
  const [newCode, setNewCode] = useState('')

  const byCode = useMemo(
    () => new Map(locations.map((l) => [l.code, l])),
    [locations],
  )

  // Liste artık sadece MB52'de görülen depolarla sınırlı değil: elle
  // tanımlanmış depolar da (henüz stok verisi gelmemiş olsa bile) burada
  // görünür, çünkü planlama hesaplaması bu tanımlara göre çalışır.
  const allCodes = useMemo(() => {
    const set = new Set<string>()
    for (const s of stockRows) {
      if (s.storageLocation) set.add(s.storageLocation)
    }
    for (const l of locations) set.add(l.code)
    return Array.from(set).sort()
  }, [stockRows, locations])

  async function addManualLocation() {
    const code = newCode.trim()
    if (!code) return
    setSaving(code)
    try {
      await upsert({ code, category: DEFAULT_CATEGORY })
      setNewCode('')
    } finally {
      setSaving(null)
    }
  }

  const stockByLocation = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of stockRows) {
      if (!s.storageLocation) continue
      map.set(
        s.storageLocation,
        (map.get(s.storageLocation) ?? 0) + (s.unrestricted ?? 0),
      )
    }
    return map
  }, [stockRows])

  async function setCategory(code: string, category: string, description?: string) {
    setSaving(code)
    try {
      await upsert({ code, category, description })
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Depo Tanımları</h1>
      <p className="mt-2 text-muted-foreground">
        Depo kodlarını elle ekle ya da MB52 yüklemesiyle otomatik gelmesini
        bekle, sonra her birinin planlamada nasıl değerlendirileceğini seç.
        Bu ayar, "hangi stok gerçekten elimde?" sorusunu belirler ve üretim
        miktarını doğrudan etkiler — planlama hesaplaması bu tanımlara göre
        çalışır.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {CATEGORIES.map((c) => (
          <div key={c.value} className="rounded-lg border border-border p-3">
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${c.color}`}>
              {c.label}
            </span>
            <p className="mt-2 text-xs text-muted-foreground">{c.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-2">
        <input
          className="w-48 rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Depo kodu (örn. 1009)"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addManualLocation()
          }}
        />
        <button
          onClick={() => void addManualLocation()}
          disabled={!newCode.trim() || saving === newCode.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Depo ekle
        </button>
      </div>

      {allCodes.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Henüz depo tanımlı değil. Yukarıdan elle ekleyebilir, ya da Stoklar
          sayfasından MB52 dosyası yükleyip depo kodlarının otomatik
          listelenmesini bekleyebilirsin.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {allCodes.map((code) => {
            const current = byCode.get(code)
            const qty = stockByLocation.get(code) ?? 0
            return (
              <div
                key={code}
                className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-foreground">{code}</span>
                    <span className="text-xs text-muted-foreground">
                      {qty.toLocaleString('tr-TR')} adet stok
                    </span>
                  </div>
                  <input
                    className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-sm sm:w-72"
                    placeholder="Bu depo ne anlama geliyor? (opsiyonel not)"
                    defaultValue={current?.description ?? ''}
                    onBlur={(e) =>
                      void setCategory(
                        code,
                        current?.category ?? DEFAULT_CATEGORY,
                        e.target.value,
                      )
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  {CATEGORIES.map((c) => {
                    const active = current?.category === c.value
                    return (
                      <button
                        key={c.value}
                        disabled={saving === code}
                        onClick={() => void setCategory(code, c.value, current?.description)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? c.color
                            : 'bg-muted text-muted-foreground hover:bg-muted/70'
                        }`}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Tanımlanmamış depolar varsayılan olarak "Mamul Deposu (Finish Good)" sayılır.
      </p>
    </div>
  )
}
