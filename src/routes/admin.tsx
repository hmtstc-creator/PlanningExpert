import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { CompanyUsers } from '../components/CompanyAdmin'
import { PageHeader } from '../components/PageHeader'
import { Tabs } from '../components/Tabs'
import { AuditList, OrgAdmin, SystemErrors } from '../components/org/OrgAdmin'
import { usePlant } from '../lib/plantContext'

export const Route = createFileRoute('/admin')({
  component: AdminPage,
})

type Tab = 'organization' | 'generals' | 'history' | 'errors'

/**
 * Administration — yalnızca General (site sahibi ve General'ler). Holding'ler,
 * şirketler, kiralanan modüller, General'ler, platform geçmişi ve sistem
 * hataları burada; başka hiçbir sayfada ve menüde yok. Sayfa kapısı
 * (TenancyGate) General olmayanı sokmaz, sunucu da her işlemi denetler.
 */
function AdminPage() {
  const { ctx } = usePlant()
  const owner = ctx?.platformRole === 'owner'
  const [tab, setTab] = useState<Tab>('organization')
  const tabs: { key: Tab; label: string }[] = [
    { key: 'organization', label: 'Holdings & companies' },
    ...(owner ? [{ key: 'generals' as const, label: 'Generals' }] : []),
    { key: 'history', label: 'Platform history' },
    { key: 'errors', label: 'System errors' },
  ]
  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="Administration"
        summary="Holdings, companies and the platform — Generals only."
        info={
          <>
            <p>
              <b>Holding</b> → <b>Company</b> → <b>Plant</b> → <b>Department</b> → <b>Cost center</b> → <b>Work center</b>. A
              holding comes first; a company is opened inside a holding. Plants, departments and cost centers of a company
              are set up by its creators on <b>Company settings</b>.
            </p>
            <p>
              <b>General</b>: opens holdings and companies, chooses the modules a company rents, suspends a company and
              appoints creators and holding board members. Only the site owner adds Generals.
            </p>
            <p>
              <b>Suspended</b> company: everybody reads, nobody writes; the data can be deleted 90 days later.
            </p>
          </>
        }
      />
      <div className="mt-4">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
      </div>
      <div className="mt-4">
        {tab === 'organization' && <OrgAdmin scope="admin" />}
        {tab === 'generals' && owner && (
          <section>
            <p className="text-xs text-muted-foreground">Generals see and manage every holding and company. Only the site owner adds or removes them.</p>
            <CompanyUsers companyId={null} groups={[]} />
          </section>
        )}
        {tab === 'history' && <AuditList />}
        {tab === 'errors' && <SystemErrors />}
      </div>
    </div>
  )
}
