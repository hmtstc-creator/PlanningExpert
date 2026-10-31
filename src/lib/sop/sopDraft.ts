// SOP taslağında ekrandan yapılan değişiklikler (saf; sopDraft.test.ts).
// Her işlev yeni bir taslak döner, girdiyi değiştirmez.

import { MAX_PHOTOS_PER_STEP, emptyApprovals, type Approval, type ApprovalRole, type Draft, type Mark, type Photo, type Step } from './sopSchema'

const withSteps = (d: Draft, steps: Step[]): Draft => ({ ...d, steps })

export const emptyStep = (): Step => ({ text: '', key: '', reason: '', photos: [] })

export function patchStep(d: Draft, i: number, patch: Partial<Omit<Step, 'photos'>>): Draft {
  return withSteps(d, d.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)))
}

/** Adımı bir öne (-1) ya da bir arkaya (+1) taşır. */
export function moveStep(d: Draft, i: number, dir: -1 | 1): Draft {
  const j = i + dir
  if (j < 0 || j >= d.steps.length) return d
  const steps = [...d.steps]
  ;[steps[i], steps[j]] = [steps[j], steps[i]]
  return withSteps(d, steps)
}

/**
 * Adımı `from` konumundan `to` konumuna taşır (sürükle-bırak). Adımın metni,
 * kutuları ve fotoğrafları birlikte gider; numaralar konuma göre kendiliğinden
 * değişir (paginate / stepNumber).
 */
export function moveStepTo(d: Draft, from: number, to: number): Draft {
  if (from < 0 || from >= d.steps.length || from === to) return d
  const target = Math.min(Math.max(0, to), d.steps.length - 1)
  const steps = [...d.steps]
  const [item] = steps.splice(from, 1)
  steps.splice(target, 0, item)
  return withSteps(d, steps)
}

/** Onay alanından bir kişinin adını ya da tarihini değiştirir. */
export function setApproval(d: Draft, role: ApprovalRole, patch: Partial<Approval>): Draft {
  const current = d.approvals ?? emptyApprovals()
  return { ...d, approvals: { ...current, [role]: { ...current[role], ...patch } } }
}

export const removeStep = (d: Draft, i: number): Draft => withSteps(d, d.steps.filter((_, k) => k !== i))

/** `after` = -1: en başa. */
export function insertStep(d: Draft, after: number): Draft {
  const steps = [...d.steps]
  steps.splice(after + 1, 0, emptyStep())
  return withSteps(d, steps)
}

function patchPhotos(d: Draft, i: number, f: (photos: Photo[]) => Photo[]): Draft {
  return withSteps(d, d.steps.map((s, k) => (k === i ? { ...s, photos: f(s.photos) } : s)))
}

export const setMark = (d: Draft, i: number, p: number, mark: Mark | undefined): Draft =>
  patchPhotos(d, i, (ph) => ph.map((x, k) => (k === p ? { ...x, mark } : x)))

export const removePhoto = (d: Draft, i: number, p: number): Draft => patchPhotos(d, i, (ph) => ph.filter((_, k) => k !== p))

/** İkinci fotoğraf (en çok 2): karesi worker'dan istenir, gelene kadar boş. */
export const addPhoto = (d: Draft, i: number, second: number): Draft =>
  patchPhotos(d, i, (ph) => (ph.length >= MAX_PHOTOS_PER_STEP ? ph : [...ph, { second }]))

/** Fotoğraf için yeni saniye: kare gelene kadar eski görüntü kalır. */
export const setSecond = (d: Draft, i: number, p: number, second: number): Draft =>
  patchPhotos(d, i, (ph) => ph.map((x, k) => (k === p ? { ...x, second } : x)))

export const togglePpe = (d: Draft, key: keyof Draft['ppe']): Draft => ({ ...d, ppe: { ...d.ppe, [key]: !d.ppe[key] } })

/**
 * Ekranda kaydedilmemiş değişiklik varken sunucudan yeni kare gelirse: yalnız
 * aynı saniyedeki fotoğrafın karesi alınır, yazılanlar kaybolmaz.
 */
export function mergeFrames(local: Draft, server: Draft): Draft {
  return withSteps(
    local,
    local.steps.map((s, i) => {
      const remote = server.steps[i]
      if (!remote) return s
      return {
        ...s,
        photos: s.photos.map((p, k) => {
          const r = remote.photos[k]
          return r?.storageId && r.second === p.second && r.storageId !== p.storageId ? { ...p, storageId: r.storageId, mark: r.mark } : p
        }),
      }
    }),
  )
}

/** Dosya adı: `GGAAYY SOP <SOP no | referans | operasyon>`. */
export function sopTitle(d: Draft): string {
  const h = d.header
  return `SOP ${(h.sopNo || h.reference || h.operation || '').trim()}`.trim()
}
