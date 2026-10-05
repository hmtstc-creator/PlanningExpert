import { describe, expect, it } from 'vitest'

import { stampAuthor } from './authorFields'

describe('yazar alanları sunucudan', () => {
  it('tarayıcının yazdığı ad oturumdaki adla değişir; boşsa doldurulur', () => {
    const declared = { material: 1, reportedBy: 1, solvedBy: 1 }
    expect(stampAuthor(declared, { material: 'A', reportedBy: 'someone else' }, 'zeynep')).toEqual({ material: 'A', reportedBy: 'zeynep', solvedBy: 'zeynep' })
  })
  it('işlevde tanımlı olmayan alan eklenmez (Convex bilinmeyen alanı reddeder)', () => {
    expect(stampAuthor({ material: 1 }, { material: 'A' }, 'zeynep')).toEqual({ material: 'A' })
  })
})
