import { crossTab } from '../lib/problemReport'

/**
 * Satır × sütun sayım tablosu (ör. hangi kalıp hangi problemi kaç kez).
 * Hücre rengi tek tonun açıktan koyuya adımı; sayı her zaman yazılı, renk
 * yalnız göz gezdirmeyi kolaylaştırır.
 */
export function ProblemMatrix<T>({
  title,
  rows,
  rowKey,
  colKey,
  rowLabel,
  maxRows = 15,
}: {
  title: string
  rows: T[]
  rowKey: (row: T) => string
  colKey: (row: T) => string
  rowLabel: string
  maxRows?: number
}) {
  const tab = crossTab(rows, rowKey, colKey)
  const shownRows = tab.rows.slice(0, maxRows)
  let peak = 0
  for (const r of shownRows) for (const c of tab.cols) peak = Math.max(peak, tab.count(r, c))
  // Tek ton (mavi) dört adım; 0 boş.
  const shade = (n: number) => {
    if (n === 0 || peak === 0) return ''
    const step = Math.ceil((n / peak) * 4)
    return ['', 'bg-[#dbe8f8]', 'bg-[#a9c8ef]', 'bg-[#6ea3e4] text-white', 'bg-[#2a78d6] text-white'][step]
  }
  return (
    <section className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {tab.rows.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">Nothing in this range.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-2 py-1 font-medium">{rowLabel}</th>
                {tab.cols.map((c) => (
                  <th key={c} className="px-2 py-1 text-center font-medium">
                    {c}
                  </th>
                ))}
                <th className="px-2 py-1 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map((r) => (
                <tr key={r} className="border-t border-border">
                  <td className="px-2 py-1 font-medium text-foreground">{r}</td>
                  {tab.cols.map((c) => {
                    const n = tab.count(r, c)
                    return (
                      <td key={c} className={`px-2 py-1 text-center tabular-nums ${shade(n)}`} title={`${r} · ${c}: ${n}`}>
                        {n > 0 ? n : ''}
                      </td>
                    )
                  })}
                  <td className="px-2 py-1 text-right font-medium tabular-nums text-foreground">
                    {tab.rowTotal(r)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tab.rows.length > maxRows && (
            <p className="mt-1 text-xs text-muted-foreground">
              Showing the {maxRows} with most problems of {tab.rows.length}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
