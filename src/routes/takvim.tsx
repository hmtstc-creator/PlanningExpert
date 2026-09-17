import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useEffect, useState } from 'react'

import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/takvim')({
  component: TakvimPage,
})

const DAYS = [
  { key: 'MO', label: 'Pazartesi' },
  { key: 'TU', label: 'Salı' },
  { key: 'WE', label: 'Çarşamba' },
  { key: 'TH', label: 'Perşembe' },
  { key: 'FR', label: 'Cuma' },
  { key: 'SA', label: 'Cumartesi' },
  { key: 'SU', label: 'Pazar' },
]

const SHIFT_PRESETS = [
  { label: '1 vardiya (8 saat)', minutes: 480 },
  { label: '2 vardiya (16 saat)', minutes: 960 },
  { label: '3 vardiya (24 saat)', minutes: 1440 },
]

function TakvimPage() {
  const calendar = useQuery(api.workCalendar.get)
  const save = useMutation(api.workCalendar.save)

  const [shiftMinutes, setShiftMinutes] = useState(480)
  const [workingDays, setWorkingDays] = useState<string[]>(['MO', 'TU', 'WE', 'TH', 'FR'])
  const [holidays, setHolidays] = useState<string[]>([])
  const [newHoliday, setNewHoliday] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (calendar) {
      setShiftMinutes(calendar.shiftMinutesPerDay)
      setWorkingDays(calendar.workingDays)
      setHolidays(calendar.holidays)
    }
  }, [calendar])

  function toggleDay(key: string) {
    setWorkingDays((prev) =>
      prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key],
    )
  }

  async function handleSave() {
    await save({ shiftMinutesPerDay: shiftMinutes, workingDays, holidays })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const weeklyMinutes = shiftMinutes * workingDays.length

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold text-foreground">Çalışma Takvimi</h1>
      <p className="mt-2 text-muted-foreground">
        Planlamanın gerçekçi olması için fabrikanın ne zaman ve ne kadar
        çalıştığını tanımla. Bu ayarlar plan sürelerinin gün/saate
        çevrilmesinde kullanılır.
      </p>

      <section className="mt-8 rounded-lg border border-border p-5">
        <h2 className="font-semibold text-foreground">Günlük çalışma süresi</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {SHIFT_PRESETS.map((p) => (
            <button
              key={p.minutes}
              onClick={() => setShiftMinutes(p.minutes)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                shiftMinutes === p.minutes
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="w-24 rounded-md border border-input bg-background px-2 py-2 text-sm"
              value={shiftMinutes}
              onChange={(e) => setShiftMinutes(Number(e.target.value) || 0)}
            />
            <span className="text-sm text-muted-foreground">dk/gün</span>
          </div>
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-border p-5">
        <h2 className="font-semibold text-foreground">Çalışma günleri</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const active = workingDays.includes(d.key)
            return (
              <button
                key={d.key}
                onClick={() => toggleDay(d.key)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {d.label}
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Haftalık toplam kapasite:{' '}
          <strong className="text-foreground">
            {(weeklyMinutes / 60).toFixed(0)} saat
          </strong>{' '}
          ({workingDays.length} gün × {shiftMinutes} dk)
        </p>
      </section>

      <section className="mt-4 rounded-lg border border-border p-5">
        <h2 className="font-semibold text-foreground">Tatiller / duruş günleri</h2>
        <div className="mt-3 flex gap-2">
          <input
            type="date"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={newHoliday}
            onChange={(e) => setNewHoliday(e.target.value)}
          />
          <button
            onClick={() => {
              if (newHoliday && !holidays.includes(newHoliday)) {
                setHolidays((prev) => [...prev, newHoliday].sort())
                setNewHoliday('')
              }
            }}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Ekle
          </button>
        </div>
        {holidays.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {holidays.map((h) => (
              <span
                key={h}
                className="flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-foreground"
              >
                {new Date(h).toLocaleDateString('tr-TR')}
                <button
                  className="text-destructive"
                  onClick={() => setHolidays((prev) => prev.filter((d) => d !== h))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => void handleSave()}
          className="rounded-md bg-foreground px-5 py-2.5 text-sm font-medium text-background hover:opacity-90"
        >
          Takvimi Kaydet
        </button>
        {saved && <span className="text-sm text-emerald-600">Kaydedildi ✓</span>}
      </div>
    </div>
  )
}
