import { Link } from '@tanstack/react-router'
import { useState } from 'react'

const LINKS = [
  { to: '/planlama', label: 'Plan' },
  { to: '/', label: 'Overview' },
  { to: '/siparisler', label: 'Demand' },
  { to: '/stoklar', label: 'Stock' },
  { to: '/gerceklesen', label: 'Actuals' },
  { to: '/referanslar', label: 'Master Data' },
  { to: '/performans', label: 'Performance' },
] as const

const SETTINGS_LINKS = [
  { to: '/makineler', label: 'Presses' },
  { to: '/kaliplar', label: 'Mold Life' },
  { to: '/depolar', label: 'Storage Locations' },
  { to: '/takvim', label: 'Work Calendar' },
  { to: '/kayitlar', label: 'Change Log' },
  { to: '/tani', label: 'Connection Diagnostics' },
] as const

export function Header() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
      <nav className="flex w-full items-center justify-between gap-4 px-6 py-3">
        <Link to="/" className="shrink-0 text-base font-semibold text-foreground">
          Ahmet Saatci
        </Link>

        <div className="flex items-center gap-1 text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              activeProps={{ className: 'bg-muted text-foreground font-medium' }}
              activeOptions={{ exact: l.to === '/' }}
            >
              {l.label}
            </Link>
          ))}

          <div className="relative">
            <button
              onClick={() => setOpen((v) => !v)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Settings ▾
            </button>
            {open && (
              <div className="absolute right-0 top-full mt-1 w-48 overflow-hidden rounded-md border border-border bg-background shadow-lg">
                {SETTINGS_LINKS.map((l) => (
                  <Link
                    key={l.to}
                    to={l.to}
                    className="block px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    activeProps={{ className: 'bg-muted text-foreground font-medium' }}
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </nav>
    </header>
  )
}
