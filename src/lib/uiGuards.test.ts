import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  asksConfirmation,
  callsDelete,
  callsMutation,
  confirmsSomewhere,
  handlerBodies,
} from './uiGuards'

const ROOTS = ['src/routes', 'src/components']

function sourceFiles(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = []
  // Alt klasörler de taranır: modül sayfaları (die-followup/, machine-followup/)
  // orada ve korumalar onları da kapsamalı.
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.tsx')) out.push({ path, source: readFileSync(path, 'utf-8') })
    }
  }
  for (const root of ROOTS) walk(root)
  return out
}

describe('gövde ayrıştırma', () => {
  it('iç içe süslü parantezleri doğru kapatır', () => {
    const src = `<input onBlur={() => { if (a) { save({ id }) } }} onChange={(e) => set(e)} />`
    expect(handlerBodies(src, 'onBlur')).toEqual(['() => { if (a) { save({ id }) } }'])
    expect(handlerBodies(src, 'onChange')).toEqual(['(e) => set(e)'])
  })

  it('kaydetme ve silme çağrılarını tanır', () => {
    expect(callsMutation('() => void save({ id })')).toBe(true)
    expect(callsMutation('(e) => setDraft(e.target.value)')).toBe(false)
    expect(callsDelete('() => void remove({ id })')).toBe(true)
    expect(callsDelete('() => void removeProduct({ id })')).toBe(true)
    // Bir uyarı kutusunu kapatmak ya da ekran durumunu sıfırlamak silme değil.
    expect(callsDelete('() => clearError()')).toBe(false)
    expect(callsDelete('() => setEditing(null)')).toBe(false)
    expect(asksConfirmation('() => { if (window.confirm("x")) void remove({}) }')).toBe(true)
  })

  it('onayı bir seviye derindeki yerel fonksiyonda da bulur', () => {
    const source = `
      async function deleteThing(id: string) {
        if (!window.confirm('sure?')) return
        await remove({ id })
      }
      <button onClick={() => void deleteThing(id)} />
    `
    expect(confirmsSomewhere(source, '() => void deleteThing(id)')).toBe(true)
    expect(confirmsSomewhere(source, '() => void removeSilently(id)')).toBe(false)
  })
})

describe('girdi sayfaları', () => {
  it('hiçbir alan alandan çıkınca sessizce kaydedilmez', () => {
    const offenders: string[] = []
    for (const { path, source } of sourceFiles()) {
      for (const body of handlerBodies(source, 'onBlur')) {
        if (callsMutation(body)) offenders.push(`${path}: ${body.slice(0, 80)}`)
      }
    }
    // Kaydetmek açık bir eylem olmalı: kullanıcı kaydedip kaydetmediğini
    // göremediğini bildirdi, üstelik kısmi kayıt diğer alanları siliyordu.
    expect(offenders).toEqual([])
  })

  it('her silme önce onay ister', () => {
    const offenders: string[] = []
    for (const { path, source } of sourceFiles()) {
      for (const body of handlerBodies(source, 'onClick')) {
        if (callsDelete(body) && !confirmsSomewhere(source, body)) {
          offenders.push(`${path}: ${body.slice(0, 80)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('düzenlenebilir tabloları olan sayfalarda açık bir kaydet yolu var', () => {
    // Satır düzenleyen her sayfa taslak katmanını kullanmalı: bu katman
    // "Unsaved" işaretini, Save butonunu ve Save all çubuğunu getiriyor.
    const editablePages = [
      'src/routes/makineler.tsx',
      'src/routes/referanslar.tsx',
      'src/routes/depolar.tsx',
      'src/routes/machine-followup/maintenance.tsx',
      'src/routes/yonetim.tsx',
      'src/components/PlannedStopsEditor.tsx',
    ]
    for (const path of editablePages) {
      const source = readFileSync(path, 'utf-8')
      expect(source, `${path} taslak katmanını kullanmalı`).toContain('useDraftRows')
      expect(source, `${path} bir Save butonu göstermeli`).toMatch(/(>\s*Save\b|'Save')/)
    }
  })
})
