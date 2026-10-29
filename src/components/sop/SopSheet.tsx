import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'

import {
  PPE_ITEMS,
  REGIONS,
  SHEET_H,
  SHEET_W,
  STEP_FILL,
  STEP_FONT,
  pageLabel,
  rect,
  slotRefs,
  stepNumber,
  type Border,
  type Font,
  type HeaderField,
  type PpeKey,
} from '../../lib/sop/sopLayout'
import type { Draft, Mark, Photo, Step } from '../../lib/sop/sopSchema'

/**
 * SOP formunun bir sayfası — şablonun (docs/sop/sop-sablon.xlsx) birebir
 * kopyası, ölçüler src/lib/sop/sopLayout.ts'ten. Ekranda düzenlenir, PDF'te
 * aynısı basılır: düzenleme araçları `print:hidden`, yazılar yerinde
 * (contentEditable). Yapı asla değişmez; uzun yazı kutuyu büyütmez, küçülür.
 */

const FONT = 'Calibri, Carlito, "Liberation Sans", Arial, sans-serif'
const ARIAL = 'Arial, "Liberation Sans", Helvetica, sans-serif'
const BW: Record<Border, number> = { thin: 1, medium: 2 }
const px = (pt: number) => (pt * 4) / 3

export interface SheetEdit {
  setHeader: (f: HeaderField, value: string) => void
  setStep: (i: number, patch: Partial<Pick<Step, 'text' | 'key' | 'reason'>>) => void
  togglePpe: (k: PpeKey) => void
  select: (i: number) => void
  /** Seçili adımın fotoğrafına kırmızı işaret çizme kipi. */
  drawing: { step: number; photo: number } | null
  setMark: (i: number, p: number, mark: Mark) => void
}

interface Props {
  draft: Draft
  page: number
  pages: number
  urls: Record<string, string | null>
  /** Yoksa salt okunur (PDF kopyası da aynı DOM'dan alınır). */
  edit?: SheetEdit
  selected?: number | null
  pending?: ReadonlySet<string>
}

const boxStyle = (ref: string, border: Border): CSSProperties => {
  const r = rect(ref)
  // Şablon kutularla eksiksiz döşeli: her kutu sağ ve alt çizgisini çizer, sayfa üst ve sol çizgiyi.
  return {
    position: 'absolute',
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    borderRight: `${BW[border]}px solid #000`,
    borderBottom: `${BW[border]}px solid #000`,
    boxSizing: 'border-box',
  }
}

const fontStyle = (f: Font): CSSProperties => ({
  fontFamily: f.family === 'arial' ? ARIAL : FONT,
  fontWeight: f.bold ? 700 : 400,
  fontStyle: f.italic ? 'italic' : 'normal',
  color: f.color ?? '#000',
})

/** Kutuya sığan yazı: taşarsa yazı küçülür (kutu büyümez). */
function FitText({
  value,
  font,
  align = 'center',
  editable,
  onChange,
}: {
  value: string
  font: Font
  align?: 'left' | 'center'
  editable?: boolean
  onChange?: (v: string) => void
}) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(px(font.size))
  const fit = useCallback(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    let s = px(font.size)
    i.style.fontSize = `${s}px`
    while (s > 8 && (i.scrollHeight > o.clientHeight - 4 || i.scrollWidth > o.clientWidth - 4)) {
      s -= 0.5
      i.style.fontSize = `${s}px`
    }
    setSize(s)
  }, [font.size])
  useLayoutEffect(fit, [fit, value])
  return (
    <div
      ref={outer}
      style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: align === 'left' ? 'flex-start' : 'center', padding: '2px 4px', overflow: 'hidden' }}
    >
      <div
        key={value}
        ref={inner}
        contentEditable={editable ? 'plaintext-only' : undefined}
        suppressContentEditableWarning
        spellCheck={false}
        onInput={fit}
        onBlur={(e) => {
          const next = e.currentTarget.innerText.replace(/\n+$/, '')
          if (next !== value) onChange?.(next)
        }}
        className={editable ? 'min-w-[2em] rounded-sm outline-none hover:bg-sky-100/70 focus:bg-sky-50 print:bg-transparent' : undefined}
        style={{ ...fontStyle(font), fontSize: size, lineHeight: 1.15, textAlign: align, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', width: align === 'left' ? '100%' : undefined }}
      >
        {value}
      </div>
    </div>
  )
}

/** Fotoğraf: kutuya oranı korunarak sığar; kırmızı işaret görüntünün üstünde. */
function PhotoView({
  photo,
  url,
  pending,
  drawing,
  onMark,
}: {
  photo: Photo
  url: string | null | undefined
  pending: boolean
  drawing: boolean
  onMark: (m: Mark) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (el) setSize({ w: el.clientWidth, h: el.clientHeight })
  }, [])
  const fitted = natural && size ? (() => {
    const k = Math.min(size.w / natural.w, size.h / natural.h)
    const w = natural.w * k
    const h = natural.h * k
    return { left: (size.w - w) / 2, top: (size.h - h) / 2, w, h }
  })() : null
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const mark = drag
    ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) }
    : photo.mark
  return (
    <div ref={box} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {url ? (
        <div
          style={fitted ? { position: 'absolute', left: fitted.left, top: fitted.top, width: fitted.w, height: fitted.h } : { position: 'absolute', inset: 0 }}
          className={drawing ? 'cursor-crosshair' : undefined}
          onPointerDown={(e) => {
            if (!drawing) return
            e.currentTarget.setPointerCapture(e.pointerId)
            const p = at(e)
            setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
          }}
          onPointerMove={(e) => drag && setDrag({ ...drag, ...((p) => ({ x1: p.x, y1: p.y }))(at(e)) })}
          onPointerUp={() => {
            if (drag && mark && mark.w > 0.02 && mark.h > 0.02) onMark(mark)
            setDrag(null)
          }}
        >
          <img
            src={url}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', userSelect: 'none' }}
          />
          {mark && (
            <div
              style={{
                position: 'absolute',
                left: `${mark.x * 100}%`,
                top: `${mark.y * 100}%`,
                width: `${mark.w * 100}%`,
                height: `${mark.h * 100}%`,
                border: '5px solid #E00000',
                borderRadius: '50%',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-neutral-400 print:hidden">{pending ? 'Getting the frame…' : 'No photo'}</div>
      )}
      {pending && url && (
        <span className="absolute top-1 right-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 print:hidden">new frame…</span>
      )}
    </div>
  )
}

export function SopSheet({ draft, page, pages, urls, edit, selected, pending }: Props) {
  const slots = Array.from({ length: 6 }, (_, s) => {
    const index = page * 6 + s
    return { s, index, step: draft.steps[index] as Step | undefined }
  })
  return (
    <div
      className="sop-sheet"
      style={{ position: 'relative', width: SHEET_W, height: SHEET_H, background: '#fff', color: '#000', borderTop: '2px solid #000', borderLeft: '2px solid #000', boxSizing: 'border-box', fontFamily: FONT }}
    >
      {REGIONS.map((r) => {
        if (r.kind === 'logo')
          return (
            <div key={r.ref} style={{ ...boxStyle(r.ref, 'medium'), padding: 6 }}>
              <img src="/sop/logo.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          )
        if (r.kind === 'blank') return <div key={r.ref} style={{ ...boxStyle(r.ref, r.border), background: r.fill }} />
        if (r.kind === 'page')
          return (
            <div key={r.ref} style={boxStyle(r.ref, r.border)}>
              <FitText value={pageLabel(page, pages)} font={r.font} />
            </div>
          )
        if (r.kind === 'text')
          return (
            <div key={r.ref} style={{ ...boxStyle(r.ref, r.border), background: r.fill }}>
              <FitText value={r.text.trim()} font={r.font} align={r.align} />
            </div>
          )
        return (
          <div key={r.ref} style={boxStyle(r.ref, r.border)}>
            <FitText value={draft.header[r.field] ?? ''} font={r.font} editable={!!edit} onChange={(v) => edit?.setHeader(r.field, v)} />
          </div>
        )
      })}

      {slots.map(({ s, index, step }) => {
        const refs = slotRefs(s)
        const isSel = edit && selected === index && step
        const photos = step?.photos ?? []
        return (
          <div key={s}>
            <div
              style={{ ...boxStyle(refs.photo, 'medium'), padding: 6, display: 'flex', gap: 6 }}
              className={isSel ? 'outline outline-4 -outline-offset-4 outline-sky-500 print:outline-none' : edit && step ? 'cursor-pointer' : undefined}
              onClick={() => step && edit?.select(index)}
            >
              {photos.map((p, k) => (
                <div key={k} style={{ flex: 1, minWidth: 0, height: '100%' }}>
                  <PhotoView
                    photo={p}
                    url={p.storageId ? urls[p.storageId] : null}
                    pending={!!pending?.has(`${index}:${k}`)}
                    drawing={!!edit?.drawing && edit.drawing.step === index && edit.drawing.photo === k}
                    onMark={(m) => edit?.setMark(index, k, m)}
                  />
                </div>
              ))}
            </div>
            <div style={{ ...boxStyle(refs.step, 'medium'), background: STEP_FILL }}>
              {step && <FitText value={step.text} font={STEP_FONT} editable={!!edit} onChange={(v) => edit?.setStep(index, { text: v })} />}
            </div>
            <div style={boxStyle(refs.key, 'medium')}>
              {step && <FitText value={step.key} font={STEP_FONT} editable={!!edit} onChange={(v) => edit?.setStep(index, { key: v })} />}
            </div>
            <div style={boxStyle(refs.reason, 'medium')}>
              {step && <FitText value={step.reason} font={STEP_FONT} editable={!!edit} onChange={(v) => edit?.setStep(index, { reason: v })} />}
            </div>
            {/* Numara kutusu yalnız dolu adımda (kullanıcı 2026-10-29). */}
            {step && (
              <div
                style={{
                  position: 'absolute',
                  left: refs.number.left,
                  top: refs.number.top,
                  width: refs.number.size,
                  height: refs.number.size,
                  border: '1px solid #000',
                  background: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: FONT,
                  fontWeight: 700,
                  fontSize: px(32),
                  boxSizing: 'border-box',
                }}
              >
                {stepNumber(page, s)}
              </div>
            )}
          </div>
        )
      })}

      {PPE_ITEMS.map((item) => {
        const r = rect(item.ref)
        const on = draft.ppe[item.key]
        return (
          <div
            key={item.key}
            style={{ position: 'absolute', left: r.left + 4, top: r.top + 4, width: r.width - 8, height: r.height - 10, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <img src={`/sop/${item.sign}`} alt="" style={{ height: '100%', objectFit: 'contain' }} />
            <img src={`/sop/${item.photo}`} alt="" style={{ height: '100%', objectFit: 'contain' }} />
            <button
              type="button"
              disabled={!edit}
              onClick={() => edit?.togglePpe(item.key)}
              style={{ width: 18, height: 18, border: '1.5px solid #000', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, lineHeight: 1, flexShrink: 0, cursor: edit ? 'pointer' : 'default' }}
              title={edit ? 'Required protective equipment — click to change' : undefined}
            >
              {on ? '✓' : ''}
            </button>
            <span style={{ fontFamily: FONT, fontSize: px(9), fontWeight: 400 }}>{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}
