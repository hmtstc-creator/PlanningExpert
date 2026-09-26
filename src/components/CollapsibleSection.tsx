import { useState, type ReactNode } from 'react'

/**
 * Gizle / göster düğmeli sayfa bölümü. Açık/kapalı durumu tarayıcıda
 * saklanır; sayfa her açılışta aynı düzende gelir.
 */
export function CollapsibleSection({
  id,
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  id: string
  title: string
  /** Kapalıyken başlığın yanında görünen kısa özet. */
  hint?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const key = `section-open:${id}`
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem(key)
      return v === null ? defaultOpen : v === '1'
    } catch {
      return defaultOpen
    }
  })
  const toggle = () => {
    setOpen((v) => {
      try {
        window.localStorage.setItem(key, v ? '0' : '1')
      } catch {
        // Saklanamıyorsa yalnızca bu oturumda kalır.
      }
      return !v
    })
  }
  return (
    <section className="mt-4 rounded-lg border border-border">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40"
      >
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </span>
        <span className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {open ? 'Hide ▴' : 'Show ▾'}
        </span>
      </button>
      {open && <div className="border-t border-border px-4 py-3">{children}</div>}
    </section>
  )
}
