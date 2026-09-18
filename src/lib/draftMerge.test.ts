import { describe, expect, it } from 'vitest'

import { dirtyKeys, mergeDrafts } from './draftMerge'

const same = (a: string, b: string) => a === b

describe('taslak birleştirme', () => {
  it('ilk yüklemede sunucu değerini alır', () => {
    const { drafts, baseline } = mergeDrafts({ a: 'x' }, {}, {}, same)
    expect(drafts).toEqual({ a: 'x' })
    expect(baseline).toEqual({ a: 'x' })
  })

  it('aynı veri tekrar geldiğinde kullanıcının yazdığını silmez', () => {
    // Sorgu tazelendi ama sunucudaki değer değişmedi.
    const { drafts } = mergeDrafts({ a: 'x' }, { a: 'kullanıcı' }, { a: 'x' }, same)
    expect(drafts).toEqual({ a: 'kullanıcı' })
  })

  it('sunucu gerçekten değiştiyse sunucu kazanır', () => {
    // Başka bir cihaz kaydı değiştirdi; ekran güncel olanı göstermeli.
    const { drafts } = mergeDrafts({ a: 'yeni' }, { a: 'kullanıcı' }, { a: 'x' }, same)
    expect(drafts).toEqual({ a: 'yeni' })
  })

  it('sunucudan düşen satırın taslağı da düşer', () => {
    const { drafts } = mergeDrafts({ b: 'y' }, { a: 'kullanıcı', b: 'y' }, { a: 'x', b: 'y' }, same)
    expect(drafts).toEqual({ b: 'y' })
  })

  it('yeni gelen satır doğrudan eklenir', () => {
    const { drafts } = mergeDrafts({ a: 'x', b: 'y' }, { a: 'a!' }, { a: 'x' }, same)
    expect(drafts).toEqual({ a: 'a!', b: 'y' })
  })

  it('kirli satırları sunucuya göre sayar', () => {
    expect(dirtyKeys({ a: 'x', b: 'y' }, { a: 'a!', b: 'y' }, same)).toEqual(['a'])
    expect(dirtyKeys({ a: 'x' }, { a: 'x' }, same)).toEqual([])
    // Taslağı olmayan satır kirli sayılmaz.
    expect(dirtyKeys({ a: 'x' }, {}, same)).toEqual([])
  })
})
