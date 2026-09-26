import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Sayfa başlığı: başlık, uzun açıklama için mavi "i" notu ve ilişkili
 * sayfalara kısayollar. Uzun açıklamalar sayfada durmaz; "i"nin üzerine
 * gelince (dokunmatikte tıklayınca) açılır. Böylece sayfa sade kalır.
 */

export interface PageLink {
  to: string
  label: string
}

export function PageHeader({
  title,
  summary,
  info,
  links,
}: {
  title: string
  /** Başlığın altında kalan tek kısa satır. */
  summary?: ReactNode
  /** Uzun açıklama: "i" notunda. */
  info?: ReactNode
  links?: PageLink[]
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          {title}
          {info && <InfoTip label={`About ${title}`}>{info}</InfoTip>}
        </h1>
        {summary && <p className="mt-1 text-sm text-muted-foreground">{summary}</p>}
      </div>
      {links && links.length > 0 && <PageLinks links={links} />}
    </div>
  )
}

/** İlişkili sayfalara küçük kısayol düğmeleri. */
export function PageLinks({ links, className = '' }: { links: PageLink[]; className?: string }) {
  return (
    <nav aria-label="Related pages" className={`flex flex-wrap items-center gap-1.5 text-xs ${className}`}>
      {links.map((l) => (
        <Link
          key={l.to}
          to={l.to}
          className="rounded-md border border-border bg-background px-2.5 py-1 font-medium text-muted-foreground hover:border-foreground/40 hover:bg-muted hover:text-foreground"
        >
          {l.label} →
        </Link>
      ))}
    </nav>
  )
}

const WIDTH = 448 // 28rem
const GAP = 6
const MARGIN = 12

/**
 * Mavi "i": üzerine gelince açıklama açılır. Not ekranın dışına taşmasın
 * diye konumu açılırken hesaplanır (fixed). Dokunmatikte tıklayınca açılır,
 * dışarı dokununca ya da Esc ile kapanır.
 */
export function InfoTip({ children, label = 'More information' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const wrapper = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  const id = useId()

  const place = useCallback(() => {
    const r = button.current?.getBoundingClientRect()
    if (!r) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(WIDTH, vw - 2 * MARGIN)
    const left = Math.max(MARGIN, Math.min(r.left - 8, vw - width - MARGIN))
    const below = vh - r.bottom - GAP - MARGIN
    const above = r.top - GAP - MARGIN
    // Aşağıda yer yoksa ve yukarıda daha çok varsa yukarı açılır.
    if (below < 200 && above > below) {
      setPos({ left, bottom: vh - r.top + GAP, width, maxHeight: Math.min(above, 480) })
    } else {
      setPos({ left, top: r.bottom + GAP, width, maxHeight: Math.max(160, Math.min(below, 480)) })
    }
  }, [])

  const show = () => {
    window.clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const hideSoon = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpen(false), 150)
  }

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!wrapper.current?.contains(t) && !panel.current?.contains(t)) setOpen(false)
    }
    const onMove = () => place()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, place])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  return (
    <span ref={wrapper} className="relative inline-flex align-middle" onMouseEnter={show} onMouseLeave={hideSoon}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onFocus={show}
        onBlur={hideSoon}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 font-serif text-xs font-bold italic leading-none text-white shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:bg-blue-500"
      >
        i
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="tooltip"
            onMouseEnter={show}
            onMouseLeave={hideSoon}
            onFocus={show}
            onBlur={hideSoon}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
            className="fixed z-50 overflow-y-auto rounded-lg border border-blue-200 bg-background p-3 text-left text-sm font-normal leading-relaxed text-muted-foreground shadow-xl dark:border-blue-900 [&_a]:text-blue-700 [&_a]:underline dark:[&_a]:text-blue-400 [&_b]:text-foreground [&_strong]:text-foreground [&_p+p]:mt-2 [&_ul]:mt-1 [&_ul]:ml-4 [&_ul]:list-disc [&_ul]:space-y-1 [&_ol]:mt-1 [&_ol]:ml-4 [&_ol]:list-decimal [&_ol]:space-y-1"
          >
            {children}
          </div>,
          document.body,
        )}
    </span>
  )
}
