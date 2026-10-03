/**
 * Sekme çubuğu (ayarlar sayfaları, şirket paneli). Seçili sekme alt çizgiyle;
 * telefonda yatay kayar.
 */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string }[]; value: T; onChange: (key: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border text-sm" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2 font-medium ${value === t.key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
