// Planlanamayan bir kalemin sebebini, yapılacak işe çevirir.
//
// Sebep metni motordan gelir. Planlamacıya "şu yüzden olmadı" demek yeterli
// değil; her sebebin somut bir çaresi var ve o çare farklı bir sayfada.

export interface UnplannedFix {
  label: string
  /** Çözümün yapıldığı sayfa; yoksa çare bu sayfadaki kuraldır. */
  to?: string
}

export function fixForUnplanned(reason: string): UnplannedFix {
  if (reason.includes('No main press')) {
    return { label: 'Set main press or tick Flexible', to: '/referanslar' }
  }
  if (reason.includes('master data')) {
    return { label: 'Add master data', to: '/referanslar' }
  }
  if (reason.includes('eligible press') || reason.includes('Pinned press')) {
    return { label: 'Set its machines', to: '/referanslar' }
  }
  if (reason.includes('Excluded')) {
    return { label: 'Remove the rule' }
  }
  if (reason.includes('No presses defined')) {
    return { label: 'Define presses', to: '/makineler' }
  }
  if (reason.includes('capacity')) {
    return { label: 'Add shifts', to: '/takvim' }
  }
  return { label: 'Move to front' }
}
