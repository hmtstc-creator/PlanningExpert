import guides from '../../lib/sop/sopGuide.i18n.json'

/**
 * Kullanıcı kılavuzu (kullanıcı 2026-10-31). Metinler `sopGuide.i18n.json`
 * içinde; dil sayfadaki dil seçicisinden gelir (tek state).
 */

export type GuideLang = keyof typeof guides
export const GUIDE_LANGS = Object.keys(guides) as GuideLang[]
export const GUIDE_LANGUAGE_NAMES: Record<GuideLang, string> = { tr: 'Türkçe', en: 'English', ro: 'Română' }

export function SopGuide({ lang }: { lang: GuideLang }) {
  const g = guides[lang]
  return (
    <section className="mt-8 rounded-xl border border-border bg-card p-4 text-sm sm:p-6" aria-labelledby="sop-guide-title">
      <h2 id="sop-guide-title" className="text-lg font-bold text-foreground">
        {g.title}
      </h2>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        {g.sections.map((s, i) => (
          <div key={i}>
            <h3 className="font-semibold text-foreground">
              {i + 1}. {s.title}
            </h3>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              {s.steps.map((t, j) => (
                <li key={j}>{t}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  )
}
