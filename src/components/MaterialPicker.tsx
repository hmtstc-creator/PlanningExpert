import { useEffect, useMemo, useRef, useState } from 'react'

import {
  filterMaterials,
  isKnownMaterial,
  type MaterialOption,
} from '../lib/materialFilter'

/**
 * Master data'dan malzeme seçme kutusu.
 *
 * Neden hazır `<datalist>` değil: tarayıcılar onu çok farklı davrandırıyor
 * — iOS Safari'de listeyi hiç açmayan, yazmadan bir şey göstermeyen
 * sürümler var — ve sahadaki telefon tam da orası. Kodlar birbirine çok
 * benzediği için (M250SP001RO / M250SP002RO) listenin her zaman açılması
 * ve yazdıkça süzülmesi gerekiyor.
 *
 * Listede olmayan bir kod yazmak ENGELLENMİYOR ama işaretleniyor: master
 * data'da olmayan bir koda yazılan kayıt plana hiç yansımaz, bunu sessizce
 * geçmek yanlış olur.
 */
export function MaterialPicker({
  options,
  value,
  onChange,
  placeholder = 'Search or pick a material',
  className = '',
  id,
}: {
  options: MaterialOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => filterMaterials(options, value), [options, value])
  const known = isKnownMaterial(options, value)

  // Dışarı tıklayınca kapansın — mobilde açık kalan liste sayfanın yarısını
  // kaplıyor.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  // Süzgeç değişince vurgu listenin dışında kalmasın.
  useEffect(() => setHighlight(0), [value])

  function choose(code: string) {
    onChange(code)
    setOpen(false)
  }

  return (
    <div ref={wrapper} className={`relative ${className}`}>
      <input
        id={id}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHighlight((h) => Math.min(h + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && open && matches[highlight]) {
            // Liste açıkken Enter seçim yapar; formu göndermemeli.
            e.preventDefault()
            choose(matches[highlight].code)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />

      {open && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No material matches “{value}”.
            </p>
          ) : (
            matches.map((option, index) => (
              <button
                key={option.code}
                type="button"
                // Girdinin blur'u seçimden önce olmasın.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option.code)}
                onMouseEnter={() => setHighlight(index)}
                className={`block w-full px-3 py-2 text-left text-sm ${
                  index === highlight ? 'bg-muted text-foreground' : 'text-foreground'
                }`}
              >
                {option.code}
                {option.coProduct && (
                  <span className="block text-[11px] text-muted-foreground">
                    co-product {option.coProduct}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {value.trim() !== '' && !known && !open && (
        <p className="mt-1 text-[11px] text-amber-700">
          Not in master data — the plan will not see this code.
        </p>
      )}
    </div>
  )
}
