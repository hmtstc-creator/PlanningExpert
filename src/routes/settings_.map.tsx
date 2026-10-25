import { Link, createFileRoute } from '@tanstack/react-router'

import { PageHeader } from '../components/PageHeader'
import { OrgMap } from '../components/org/OrgMap'

export const Route = createFileRoute('/settings_/map')({
  component: CompanyMapPage,
})

/**
 * Organization map — Company settings altında, şirketi yöneten (creator ya da
 * General) için; kapı TenancyGate'te `/settings` önekiyle. Yalnız seçili şirket
 * görünür, holding işlemleri yoktur (onlar Administration → Organization map'te).
 */
function CompanyMapPage() {
  return (
    <div className="w-full px-4 py-6 pb-10 sm:px-6 sm:py-8">
      <PageHeader
        title="Organization map"
        summary="Your company's plants, departments, cost centers, users and groups on one canvas — drag to relink."
        info={
          <>
            <p>
              <b>Structure</b>: Company → Plant → Department → Cost center → Work center, left to right. Red frame = something to fix
              (same-named plants, cost centers without a department, work centers without a cost center). The list on the right jumps to
              each one.
            </p>
            <p>
              <b>Drag and drop</b>: a cost center onto a department of the same plant, a work center onto a cost center, a user onto a
              group, a group onto a plant. Every move asks first and is written to the change history. Click a line in{' '}
              <b>Users & groups</b> to remove that membership or plant.
            </p>
            <p>
              Select a node to rename, add or delete. Passwords and permissions stay on{' '}
              <Link to="/users" className="underline">
                Users & permissions
              </Link>
              .
            </p>
          </>
        }
      />
      <div className="mt-4">
        <OrgMap scope="company" />
      </div>
    </div>
  )
}
