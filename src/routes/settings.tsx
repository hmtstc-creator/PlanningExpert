import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'

import { PageHeader } from '../components/PageHeader'
import { Tabs } from '../components/Tabs'
import { AuditList, CompanyPeople, OrgAdmin } from '../components/org/OrgAdmin'
import { PlantChangeLog } from '../components/settings/PlantChangeLog'
import { SelectionLists } from '../components/settings/SelectionLists'
import { usePlant } from '../lib/plantContext'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

type Tab = 'organization' | 'people' | 'lists' | 'history'

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
        title="Company settings"
        summary={`${ctx?.active?.companyName ?? ''} — plants, departments, cost centers, users and lists.`}
        info={
          <>
            <p>
              <b>Plant</b> → <b>Department</b> → <b>Cost center</b> → <b>Work center</b>: every cost center belongs to a department,
              every work center (Work Center Definitions) to a cost center.
            </p>
            <p>
              <b>Users &amp; groups</b>: a creator manages the whole company; other users get plants × module permissions through
              their groups. New users sign in with a temporary password and replace it at the first sign-in.
            </p>
            <p>
              <b>Selection lists</b> and the <b>plant change log</b> belong to the selected plant (header).
            </p>
          </>
        }
      />
      <div className="mt-4">
        <Tabs
          tabs={[
            { key: 'organization', label: 'Organization' },
            { key: 'people', label: 'Users & groups' },
            { key: 'lists', label: 'Selection lists' },
            { key: 'history', label: 'Change history' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="mt-4">
        {tab === 'organization' && <OrgAdmin scope="company" />}
        {tab === 'people' && companyId && <CompanyPeople companyId={companyId} />}
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
