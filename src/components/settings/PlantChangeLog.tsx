import { api } from '../../../convex/_generated/api'
import { useQuery } from '../../lib/convexTransport'

/** Plant'in değişiklik kaydı: plan onayı, bakım, kalıp, problem, kullanıcı … (son 50). */
export function PlantChangeLog() {
  const logs = (useQuery(api.changeLog.recent, { limit: 50 }) ?? []) as {
    _id: string
    title: string
    detail?: string
    category: string
    author?: string
    createdAt: number
  }[]
  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground">
        Who changed what (last {logs.length})
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Written automatically when a plan is approved, maintenance is booked or
        completed, a mold is held or released, a problem is reported or solved,
        and when users change.
      </p>
      {logs.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Nothing recorded yet.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">What</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log._id} className="border-t border-border">
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">
                    {new Date(log.createdAt).toLocaleString('en-GB')}
                  </td>
                  <td className="px-3 py-2 text-xs text-foreground">{log.author ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="text-foreground">{log.title}</span>
                    {log.detail && (
                      <span className="block text-xs text-muted-foreground">{log.detail}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}
