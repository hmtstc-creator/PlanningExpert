/**
 * Organizasyon haritası (Administration → Organization map): yapı ve
 * kişiler sonsuz bir tuvalde, bağlarıyla. Saf fonksiyonlar: düğüm / kenar
 * listesi, yerleşim (soldan sağa ağaç), uyarılar ve sürükle-bırakın hangi
 * işleme dönüştüğü. Ekran (OrgMap.tsx) yalnızca çizer ve sunucuya gönderir;
 * kurallar burada ve sunucuda (platform.ts, users.ts) — ikisi aynı şeyi söyler.
 *
 * İki görünüm:
 * - Yapı: Holding → Company → Plant → Department → Cost center → Work center.
 * - Kişiler (tek şirket): Company → Plant → Group → User. Grup hangi plant'leri
 *   görüyor, kullanıcı hangi grupta.
 */

import { companiesOf, departmentsOf, orphanCompanies, unassignedOf, unlinkedWorkCenters, workCentersOf, type OrgCompany, type OrgHolding, type OrgPlant } from './orgTree'

export type MapLevel = 'holding' | 'company' | 'plant' | 'department' | 'costCenter' | 'workCenter' | 'group' | 'user'

/** Düğümün gerçek kaydı; sanal kutular ("No holding", "Without a department") `virtual`. */
export type MapRef =
  | { kind: 'holding'; id: string }
  | { kind: 'company'; id: string }
  | { kind: 'plant'; id: string; companyId: string }
  | { kind: 'department'; plantId: string; name: string }
  | { kind: 'costCenter'; plantId: string; code: string; department?: string }
  | { kind: 'workCenter'; plantId: string; name: string }
  | { kind: 'group'; id: string; companyId: string }
  | { kind: 'user'; id: string; companyId: string }
  | { kind: 'virtual' }

export interface MapNode {
  id: string
  level: MapLevel
  label: string
  /** İkinci satır: kod, sayılar, rol. */
  sub?: string
  x: number
  y: number
  ref: MapRef
  /** Gizlenebilir alt düğüm sayısı (0 → ok düğmesi yok). */
  children: number
  collapsed: boolean
  /** Düzeltilmesi gereken eksikler (kırmızı çerçeve + liste). */
  warnings: string[]
}

export type EdgeKind = 'tree' | 'access' | 'member'

export interface MapEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
}

export interface MapGraph {
  nodes: MapNode[]
  edges: MapEdge[]
}

export const NODE_W = 210
export const NODE_H = 48
const COL = 270
const ROW = 64

const COLUMN: Record<MapLevel, number> = { holding: 0, company: 1, plant: 2, department: 3, costCenter: 4, workCenter: 5, group: 1, user: 2 }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const norm = (s: string) => s.trim().toLowerCase()

/** Aynı şirkette (büyük / küçük harf ve boşluk farkı yok sayılarak) aynı adı taşıyan plant'ler. */
export function duplicatePlants(company: OrgCompany): Set<string> {
  const byName = new Map<string, string[]>()
  for (const p of company.plants) byName.set(norm(p.name), [...(byName.get(norm(p.name)) ?? []), p._id])
  return new Set([...byName.values()].filter((ids) => ids.length > 1).flat())
}

// ---- Yapı görünümü ----------------------------------------------------------------

interface Tree {
  id: string
  level: MapLevel
  label: string
  sub?: string
  ref: MapRef
  warnings: string[]
  kids: Tree[]
}

const leaf = (t: Omit<Tree, 'kids' | 'warnings'> & { warnings?: string[] }, kids: Tree[] = []): Tree => ({ warnings: [], ...t, kids })

function plantTree(c: OrgCompany, p: OrgPlant, dups: Set<string>): Tree {
  const warnings: string[] = []
  if (dups.has(p._id)) warnings.push(`Another plant of ${c.name} has the same name — delete or rename one`)
  if (!(p.departments ?? []).length) warnings.push('No department yet')
  const wcOf = (code: string) =>
    workCentersOf(p, code).map((w) => leaf({ id: `wc:${p._id}:${w.name}`, level: 'workCenter', label: w.name, ref: { kind: 'workCenter', plantId: p._id, name: w.name } }))
  const ccTree = (cc: { code: string; name: string; department?: string }) => {
    const kids = wcOf(cc.code)
    return leaf(
      {
        id: `cc:${p._id}:${cc.code}`,
        level: 'costCenter',
        label: cc.name,
        sub: `${cc.code} · ${plural(kids.length, 'work center')}`,
        ref: { kind: 'costCenter', plantId: p._id, code: cc.code, department: cc.department },
      },
      kids,
    )
  }
  const kids: Tree[] = departmentsOf(p).map((d) =>
    leaf(
      {
        id: `d:${p._id}:${d.name}`,
        level: 'department',
        label: d.name,
        sub: plural(d.costCenters.length, 'cost center'),
        ref: { kind: 'department', plantId: p._id, name: d.name },
        warnings: d.costCenters.length ? [] : ['No cost center yet — drag one here'],
      },
      d.costCenters.map(ccTree),
    ),
  )
  const loose = unassignedOf(p)
  if (loose.length) {
    kids.push(
      leaf(
        {
          id: `d:${p._id}:`,
          level: 'department',
          label: 'Without a department',
          sub: plural(loose.length, 'cost center'),
          ref: { kind: 'virtual' },
          warnings: ['Drag each cost center onto its department'],
        },
        loose.map(ccTree),
      ),
    )
  }
  const unlinked = unlinkedWorkCenters(p)
  if (unlinked.length) {
    kids.push(
      leaf(
        {
          id: `cc:${p._id}:`,
          level: 'costCenter',
          label: 'No cost center',
          sub: plural(unlinked.length, 'work center'),
          ref: { kind: 'virtual' },
          warnings: ['Choose the cost center on Work Center Definitions'],
        },
        unlinked.map((w) => leaf({ id: `wc:${p._id}:${w.name}`, level: 'workCenter', label: w.name, ref: { kind: 'workCenter', plantId: p._id, name: w.name } })),
      ),
    )
  }
  const counts = [plural((p.departments ?? []).length, 'dept'), plural((p.costCenters ?? []).length, 'CC'), plural((p.workCenters ?? []).length, 'WC')]
  return leaf({ id: `p:${p._id}`, level: 'plant', label: p.name, sub: counts.join(' · '), ref: { kind: 'plant', id: p._id, companyId: c._id }, warnings }, kids)
}

function companyTree(c: OrgCompany & { userCount?: number }): Tree {
  const dups = duplicatePlants(c)
  const sub = [plural(c.plants.length, 'plant'), c.userCount !== undefined ? plural(c.userCount, 'user') : null, c.status === 'suspended' ? 'suspended' : null]
  return leaf(
    { id: `c:${c._id}`, level: 'company', label: c.name, sub: sub.filter(Boolean).join(' · '), ref: { kind: 'company', id: c._id } },
    [...c.plants].sort((a, b) => a.name.localeCompare(b.name)).map((p) => plantTree(c, p, dups)),
  )
}

/** Düğüm kapalı mı (altı gizli)? Ekran varsayılanı ve kullanıcının tıklamalarını birleştirir. */
export type Collapsed = (id: string, level: MapLevel) => boolean

/**
 * Yapı ağacı. General bütün holding'leri görür; holding'siz şirketler
 * "No holding" kutusunda (sürükleyip bir holding'e bırakılır). Holding'i
 * görmeyen (creator) yalnızca şirketinden başlar.
 */
export function structureGraph(holdings: OrgHolding[], companies: (OrgCompany & { userCount?: number })[], collapsed: Collapsed): MapGraph {
  const roots: Tree[] = holdings
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((h) => {
      const cs = companiesOf(h._id, companies)
      return leaf(
        { id: `h:${h._id}`, level: 'holding', label: h.name, sub: plural(cs.length, 'company'), ref: { kind: 'holding', id: h._id }, warnings: cs.length ? [] : ['No company yet'] },
        cs.map(companyTree),
      )
    })
  const orphans = holdings.length ? orphanCompanies(holdings, companies) : []
  if (orphans.length) {
    roots.push(
      leaf(
        {
          id: 'h:',
          level: 'holding',
          label: 'No holding',
          sub: plural(orphans.length, 'company'),
          ref: { kind: 'virtual' },
          warnings: ['Drag each company onto its holding'],
        },
        orphans.map(companyTree),
      ),
    )
  }
  if (!holdings.length) roots.push(...companies.map(companyTree))
  return layoutTrees(roots, collapsed)
}

/** Soldan sağa ağaç: her yaprak bir satır, ebeveyn çocuklarının ortasında; sütun seviyeden. */
function layoutTrees(roots: Tree[], collapsed: Collapsed): MapGraph {
  const nodes: MapNode[] = []
  const edges: MapEdge[] = []
  let row = 0
  const place = (t: Tree): number => {
    const isClosed = t.kids.length > 0 && collapsed(t.id, t.level)
    let y: number
    if (!t.kids.length || isClosed) {
      y = row++ * ROW
    } else {
      const ys = t.kids.map((k) => {
        edges.push({ id: `${t.id}>${k.id}`, source: t.id, target: k.id, kind: 'tree' })
        return place(k)
      })
      y = (ys[0] + ys[ys.length - 1]) / 2
    }
    // Kapalı düğüm altındaki eksikleri de taşır: gizli sorun görünmez kalmasın.
    const hidden = isClosed ? hiddenWarnings(t) : 0
    nodes.push({
      id: t.id,
      level: t.level,
      label: t.label,
      sub: t.sub,
      x: COLUMN[t.level] * COL,
      y,
      ref: t.ref,
      children: t.kids.length,
      collapsed: isClosed,
      warnings: hidden ? [...t.warnings, `${plural(hidden, 'issue')} inside — open to see`] : t.warnings,
    })
    return y
  }
  for (const r of roots) {
    place(r)
    row += 0.5
  }
  return { nodes, edges }
}

function hiddenWarnings(t: Tree): number {
  return t.kids.reduce((n, k) => n + (k.warnings.length ? 1 : 0) + hiddenWarnings(k), 0)
}

// ---- Kişiler görünümü -------------------------------------------------------------

export interface MapUser {
  _id: string
  name: string
  active: boolean
  isCreator: boolean
  groupIds: string[]
}

export interface MapGroup {
  _id: string
  name: string
  allPlants: boolean
  plantIds: string[]
  board?: boolean
}

/**
 * Şirketin kişileri, soldan sağa ağaç gibi: Company → Plant → Group → User.
 * Plant → grup kenarı "bu grup plant'i görür" (her plant'i gören grup doğrudan
 * şirkete bağlanır), grup → kullanıcı kenarı "kullanıcı bu grupta".
 * Kenar her zaman soldaki düğümden sağdakine gider (geri dönen çizgi yok).
 * Creator gruptan bağımsız her plant'i görür.
 */
export function peopleGraph(company: OrgCompany, users: MapUser[], groups: MapGroup[]): MapGraph {
  const nodes: MapNode[] = []
  const edges: MapEdge[] = []
  const plants = [...company.plants].sort((a, b) => a.name.localeCompare(b.name))
  const pIndex = new Map(plants.map((p, i) => [p._id, i]))
  // Gruplar gördükleri ilk plant'in hizasında (bütün plant'leri görenler en üstte): kenarlar daha az kesişir.
  const firstPlant = (g: MapGroup) => (g.allPlants ? -1 : Math.min(...g.plantIds.map((p) => pIndex.get(p) ?? Infinity), Infinity))
  const gs = [...groups].sort((a, b) => firstPlant(a) - firstPlant(b) || a.name.localeCompare(b.name))
  const gIndex = new Map(gs.map((g, i) => [g._id, i]))
  // Kullanıcılar ilk grubunun yanında: kenarlar daha az kesişir.
  const firstGroup = (u: MapUser) => (u.isCreator ? -1 : Math.min(...u.groupIds.map((g) => gIndex.get(g) ?? Infinity), Infinity))
  const us = [...users].sort((a, b) => firstGroup(a) - firstGroup(b) || a.name.localeCompare(b.name))
  const tallest = Math.max(plants.length, gs.length, us.length, 1)
  const top = (n: number) => ((tallest - n) * ROW) / 2

  nodes.push({
    id: `c:${company._id}`,
    level: 'company',
    label: company.name,
    sub: `${plural(plants.length, 'plant')} · ${plural(gs.length, 'group')} · ${plural(us.length, 'user')}`,
    x: 0,
    y: ((tallest - 1) * ROW) / 2,
    ref: { kind: 'company', id: company._id },
    children: 0,
    collapsed: false,
    warnings: [],
  })
  const dups = duplicatePlants(company)
  plants.forEach((p, i) => {
    const seenBy = gs.filter((g) => g.allPlants || g.plantIds.includes(p._id))
    nodes.push({
      id: `p:${p._id}`,
      level: 'plant',
      label: p.name,
      sub: plural(seenBy.length, 'group'),
      x: COL,
      y: top(plants.length) + i * ROW,
      ref: { kind: 'plant', id: p._id, companyId: company._id },
      children: 0,
      collapsed: false,
      warnings: dups.has(p._id) ? [`Another plant of ${company.name} has the same name — delete or rename one`] : [],
    })
    edges.push({ id: `c:${company._id}>p:${p._id}`, source: `c:${company._id}`, target: `p:${p._id}`, kind: 'tree' })
  })
  gs.forEach((g, i) => {
    const members = us.filter((u) => u.groupIds.includes(g._id))
    const seen = g.allPlants ? plants : plants.filter((p) => g.plantIds.includes(p._id))
    const warnings: string[] = []
    if (!seen.length) warnings.push('Sees no plant — drag it onto a plant')
    if (!members.length) warnings.push('No member yet')
    nodes.push({
      id: `g:${g._id}`,
      level: 'group',
      label: g.name,
      sub: [g.allPlants ? 'all plants' : plural(seen.length, 'plant'), plural(members.length, 'member'), g.board ? 'board' : null].filter(Boolean).join(' · '),
      x: 2 * COL,
      y: top(gs.length) + i * ROW,
      ref: { kind: 'group', id: g._id, companyId: company._id },
      children: 0,
      collapsed: false,
      warnings,
    })
    if (g.allPlants) edges.push({ id: `c:${company._id}>g:${g._id}`, source: `c:${company._id}`, target: `g:${g._id}`, kind: 'access' })
    else for (const p of seen) edges.push({ id: `p:${p._id}>g:${g._id}`, source: `p:${p._id}`, target: `g:${g._id}`, kind: 'access' })
  })
  us.forEach((u, i) => {
    const mine = u.groupIds.filter((g) => gIndex.has(g))
    const warnings = !u.isCreator && !mine.length && u.active ? ['In no group — sees nothing; drag onto a group'] : []
    nodes.push({
      id: `u:${u._id}`,
      level: 'user',
      label: u.name,
      sub: [u.isCreator ? 'Creator — every plant' : plural(mine.length, 'group'), u.active ? null : 'inactive'].filter(Boolean).join(' · '),
      x: 3 * COL,
      y: top(us.length) + i * ROW,
      ref: { kind: 'user', id: u._id, companyId: company._id },
      children: 0,
      collapsed: false,
      warnings,
    })
    for (const g of mine) edges.push({ id: `g:${g}>u:${u._id}`, source: `g:${g}`, target: `u:${u._id}`, kind: 'member' })
  })
  return { nodes, edges }
}

// ---- Sürükle-bırak ve bağ kaldırma -----------------------------------------------

export type MapAction =
  | { kind: 'companyHolding'; companyId: string; holdingId: string; text: string }
  | { kind: 'costCenterDepartment'; plantId: string; code: string; department: string; text: string }
  | { kind: 'userGroup'; userId: string; groupId: string; add: boolean; text: string }
  | { kind: 'groupPlant'; groupId: string; plantId: string; add: boolean; text: string }

/**
 * Sürüklenen düğüm hedefe bırakılınca ne olur? `null` → geçersiz (düğüm
 * yerine döner). Yetki: şirket → holding yalnızca General (`canLinkHoldings`).
 */
export function dropAction(
  dragged: MapNode,
  target: MapNode,
  ctx: { canLinkHoldings: boolean; edges: MapEdge[]; users?: MapUser[]; groups?: MapGroup[] },
): MapAction | null {
  const d = dragged.ref
  const t = target.ref
  if (d.kind === 'company' && t.kind === 'holding') {
    // Zaten bu holding'in altındaysa bırakmak bir şey değiştirmez.
    if (!ctx.canLinkHoldings || ctx.edges.some((e) => e.kind === 'tree' && e.source === target.id && e.target === dragged.id)) return null
    return { kind: 'companyHolding', companyId: d.id, holdingId: t.id, text: `Move ${dragged.label} under ${target.label}` }
  }
  if (d.kind === 'costCenter' && t.kind === 'department') {
    if (d.plantId !== t.plantId || d.department === t.name) return null
    return { kind: 'costCenterDepartment', plantId: d.plantId, code: d.code, department: t.name, text: `Move cost center ${d.code} to ${target.label}` }
  }
  if (d.kind === 'user' && t.kind === 'group') {
    const u = ctx.users?.find((x) => x._id === d.id)
    if (!u || d.companyId !== t.companyId || u.groupIds.includes(t.id)) return null
    return { kind: 'userGroup', userId: d.id, groupId: t.id, add: true, text: `Add ${dragged.label} to ${target.label}` }
  }
  if (d.kind === 'group' && t.kind === 'plant') {
    const g = ctx.groups?.find((x) => x._id === d.id)
    if (!g || d.companyId !== t.companyId || g.allPlants || g.plantIds.includes(t.id)) return null
    return { kind: 'groupPlant', groupId: d.id, plantId: t.id, add: true, text: `Let ${dragged.label} see ${target.label}` }
  }
  return null
}

/** Kenar kaldırılabilir mi (plant → grup, grup → kullanıcı)? Ağaç kenarı sürükleyerek değişir. */
export function removeAction(edge: MapEdge, nodes: MapNode[], groups: MapGroup[]): MapAction | null {
  const s = nodes.find((n) => n.id === edge.source)
  const t = nodes.find((n) => n.id === edge.target)
  if (!s || !t) return null
  if (edge.kind === 'member' && s.ref.kind === 'group' && t.ref.kind === 'user') {
    return { kind: 'userGroup', userId: t.ref.id, groupId: s.ref.id, add: false, text: `Remove ${t.label} from ${s.label}` }
  }
  if (edge.kind === 'access' && s.ref.kind === 'plant' && t.ref.kind === 'group') {
    const g = groups.find((x) => x._id === (t.ref as { id: string }).id)
    if (!g || g.allPlants) return null
    return { kind: 'groupPlant', groupId: g._id, plantId: s.ref.id, add: false, text: `${t.label} no longer sees ${s.label}` }
  }
  return null
}

/** Arama: ada / alt satıra göre eşleşen düğümler (büyük / küçük harf yok sayılır). */
export function findNodes(nodes: MapNode[], query: string): MapNode[] {
  const q = norm(query)
  if (!q) return []
  return nodes.filter((n) => norm(n.label).includes(q) || norm(n.sub ?? '').includes(q))
}

/** Bütün uyarılar, tepeden aşağı (liste ve sayı). */
export function warningsOf(graph: MapGraph): { node: MapNode; text: string }[] {
  return [...graph.nodes].sort((a, b) => COLUMN[a.level] - COLUMN[b.level] || a.y - b.y).flatMap((n) => n.warnings.map((text) => ({ node: n, text })))
}
