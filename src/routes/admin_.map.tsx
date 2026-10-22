import { Link, createFileRoute } from '@tanstack/react-router'

import { PageHeader } from '../components/PageHeader'
import { OrgMap } from '../components/org/OrgMap'

export const Route = createFileRoute('/admin_/map')({
  component: OrgMapPage,
})

/**
 * Organization map — yalnızca General (Administration altında; kapı
 * TenancyGate'te `/admin` önekiyle). Holdings & companies ve Users &
 * permissions sayfaları yerinde kalır; harita bağları görsel olarak
 * gösterir ve sürükle-bırakla değiştirir.
 */
function OrgMapPage() {
  return (
    <div className="w-full px-4 py-6 pb-10 sm:px-6 sm:py-8">
      <PageHeader
        title="Organization map"
        summary="Holdings, companies, plants, cost centers, users and groups on one canvas — drag to relink."
        info={
          <>
            <p>
              <b>Structure</b>: Holding → Company → Plant → Department → Cost center → Work center, left to right. Red frame = something
              to fix (same-named plants, a company without holding, cost centers without a department, work centers without a cost
              center). The list on the right jumps to each one.
            </p>
            <p>
              <b>Drag and drop</b>: a company onto a holding, a cost center onto a department of the same plant, a user onto a group, a
              group onto a plant. Every move asks first and is written to Platform history. Click a line in <b>Users & groups</b> to
              remove that membership or plant.
            </p>
            <p>
              Scroll to zoom, drag the background to move. Renaming, adding and deleting stay on{' '}
              <Link to="/admin" className="underline">
                Holdings & companies
              </Link>{' '}
              and Users & permissions.
            </p>
          </>
        }
      />
      <div className="mt-4">
        <OrgMap />
      </div>
    </div>
  )
}
