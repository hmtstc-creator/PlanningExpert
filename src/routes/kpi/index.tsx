import { createFileRoute, Link } from '@tanstack/react-router'

import { PageHeader } from '../../components/PageHeader'

export const Route = createFileRoute('/kpi/')({
  component: KpiHome,
})

const GROUPS = [
  {
    title: 'Monthly KPI',
    text: 'Plan and actual per cost center, month by month.',
    links: [
      { to: '/kpi/monthly/entry', label: 'Data entry', hint: 'Choose month and year, enter plan and actual' },
      { to: '/kpi/monthly/dashboard', label: 'Dashboard', hint: 'One A3 page: 12 months, cards and table; print / PDF' },
    ],
  },
  {
    title: 'Weekly KPI',
    text: 'The same KPIs per ISO week.',
    links: [
      { to: '/kpi/weekly/entry', label: 'Data entry', hint: 'Choose week and year, enter plan and actual' },
      { to: '/kpi/weekly/dashboard', label: 'Dashboard', hint: 'One A3 page: 13 weeks, cards and table; print / PDF' },
    ],
  },
] as const

/** KPI modülü: aylık ve haftalık, her birinde veri girişi ve dashboard. */
function KpiHome() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="KPI"
        summary="Operators, production, presence, overtime, absenteeism, productivity and OEE — plan against actual per cost center."
      />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} className="rounded-xl border border-border p-5">
            <h2 className="text-lg font-semibold text-foreground">{g.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{g.text}</p>
            <div className="mt-4 space-y-2">
              {g.links.map((l) => (
                <Link key={l.to} to={l.to} className="block rounded-lg border border-foreground/20 p-3 hover:border-foreground hover:bg-muted/50">
                  <span className="font-medium text-foreground">{l.label}</span>
                  <span className="block text-xs text-muted-foreground">{l.hint}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
