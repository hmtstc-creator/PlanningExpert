import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { PageHeader } from '../components/PageHeader'
import { Tabs } from '../components/Tabs'
import { AuditList, OrgAdmin } from '../components/org/OrgAdmin'
import { PlantChangeLog } from '../components/settings/PlantChangeLog'
import { SelectionLists } from '../components/settings/SelectionLists'
import { relatedPages } from '../lib/navigation'
import { usePlant } from '../lib/plantContext'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

type Tab = 'organization' | 'lists' | 'history'

/**
 * Company settings — şirketin creator'ları (ve seçili şirkette General):
 * plant / bölüm / cost center, kullanıcılar ve gruplar, seçim listeleri,
 * değişiklik geçmişi. Holding ve şirket yönetimi burada yok
 * (Administration). Sayfa her zaman seçili plant'in şirketini gösterir.
 */
function SettingsPage() {
  const { ctx } = usePlant()
  const [tab, setTab] = useState<Tab>('organization')
  const companyId = ctx?.active?.companyId
  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        links={relatedPages('/settings')}
        title="Company settings"
        summary={`${ctx?.active?.companyName ?? ''} — plants, departments, cost centers, users and lists.`}
        info={
          <>
            <p>
              <b>Plant</b> → <b>Department</b> → <b>Cost center</b> → <b>Work center</b>: every cost center belongs to a department,
              every work center (Work Center Definitions) to a cost center.
            </p>
            <p>
              Users, groups and permissions have their own page: <b>Users &amp; permissions</b>.
            </p>
            <p>
              <b>Selection lists</b> and the <b>plant change log</b> belong to the selected plant (header).
            </p>
          </>
        }
      />
      <p className="mt-3 text-sm">
        Users, groups and the permission matrix:{' '}
        <Link to="/users" className="font-medium text-primary underline">
          Users &amp; permissions →
        </Link>
      </p>
      <div className="mt-4">
        <Tabs
          tabs={[
            { key: 'organization', label: 'Organization' },
            { key: 'lists', label: 'Selection lists' },
            { key: 'history', label: 'Change history' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="mt-4">
        {tab === 'organization' && <OrgAdmin scope="company" />}
        {tab === 'lists' && <SelectionLists />}
        {tab === 'history' && companyId && (
          <div className="space-y-8">
            <section>
              <h2 className="text-sm font-semibold text-foreground">Company — users, groups, plants, departments, cost centers</h2>
              <div className="mt-2">
                <AuditList companyId={companyId} />
              </div>
            </section>
            <section>
              <PlantChangeLog />
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
