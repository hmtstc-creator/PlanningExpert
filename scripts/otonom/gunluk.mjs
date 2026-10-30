#!/usr/bin/env node
// Otonom Gelişim kaydı (wiki 13): src/data/otonom-gunluk.json'a bir saatlik kart ekler ve
// docs/otonom/durum.md'yi (toplantının okuduğu ≤60 satırlık özet, T1) yeniden yazar.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const [zaman, hazir, toplantilar, ...idler] = process.argv.slice(2)
const GUNLUK = 'src/data/otonom-gunluk.json'
const kayit = existsSync(GUNLUK) ? JSON.parse(readFileSync(GUNLUK, 'utf8')) : []
const satirlar = existsSync(toplantilar) ? readFileSync(toplantilar, 'utf8').trim().split('\n').filter(Boolean) : []
const sonToplanti = satirlar.length ? JSON.parse(satirlar.at(-1)) : {}
const gorevler = idler.map((id) => JSON.parse(readFileSync(`${hazir}/${id}.json`, 'utf8')))
kayit.unshift({
  zaman,
  odak: sonToplanti.odak ?? '',
  ozet: sonToplanti.ozet ?? '',
  durum: gorevler.length ? 'yayinda' : 'degisiklik-yok',
  gorevler: gorevler.map(({ baslik, once, sonra, dosyalar }) => ({ baslik, once, sonra, dosyalar })),
  oneriler: sonToplanti.oneriler ?? [],
})
writeFileSync(GUNLUK, JSON.stringify(kayit.slice(0, 500), null, 1) + '\n')

const durum = ['# Otonom döngü — durum özeti', '', '> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.', '', '## Son kararlar']
for (const k of kayit.slice(0, 3)) {
  durum.push(`- ${k.zaman} · ${k.odak} · ${k.durum}: ${k.ozet}`.slice(0, 400))
  for (const g of k.gorevler) durum.push(`  - ${g.baslik}`)
}
durum.push('', '## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)')
for (const o of [...new Set(kayit.slice(0, 10).flatMap((k) => k.oneriler))].slice(0, 10)) durum.push(`- ${o}`.slice(0, 300))
writeFileSync('docs/otonom/durum.md', durum.join('\n') + '\n')
