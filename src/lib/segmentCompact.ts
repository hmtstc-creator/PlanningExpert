// Bir işin zaman parçalarını saklanabilir boyuta indirir.
//
// Her rulo bir üretim parçası ve bir rulo değişimi ekler. Master data'da
// rulo ağırlığı yanlışsa (ör. kg yerine ton) tek bir iş binlerce ruloya
// bölünür; Convex bir dizide en fazla 8192 öğe taşıdığı için bütün plan
// kaydedilemez olur. Böyle işlerde yan yana duran üretim ve rulo parçaları
// birleştirilir — Gantt'ta iş aynı yerde görünür, yalnızca rulo değişimleri
// tek tek çizilmez. Normal işlere dokunulmaz.

export interface Segment {
  kind: string
  date: string
  start: number
  end: number
}

/** Bu sayının altındaki işler olduğu gibi kalır. */
export const MAX_SEGMENTS = 2000

const EPS = 0.001

export function compactSegments<S extends Segment>(segments: S[], max = MAX_SEGMENTS): S[] {
  if (segments.length <= max) return segments

  // 1) Aynı gün, birbirine değen üretim/rulo parçalarını tek üretim parçası yap.
  const merged: S[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    const joinable = (k: string) => k === 'run' || k === 'coil'
    if (
      last &&
      last.date === seg.date &&
      joinable(last.kind) &&
      joinable(seg.kind) &&
      seg.start <= last.end + EPS
    ) {
      merged[merged.length - 1] = { ...last, kind: 'run', end: Math.max(last.end, seg.end) }
    } else {
      merged.push(joinable(seg.kind) ? { ...seg, kind: 'run' } : seg)
    }
  }
  if (merged.length <= max) return merged

  // 2) Hâlâ çoksa: gün başına tek aralık.
  const byDate = new Map<string, S>()
  for (const seg of merged) {
    const cur = byDate.get(seg.date)
    byDate.set(
      seg.date,
      cur
        ? { ...cur, kind: 'run', start: Math.min(cur.start, seg.start), end: Math.max(cur.end, seg.end) }
        : { ...seg },
    )
  }
  return [...byDate.values()].slice(0, max)
}
