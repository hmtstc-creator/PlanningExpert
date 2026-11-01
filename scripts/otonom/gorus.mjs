// Görüş pilotu (wiki 13): roller gerçek sayfayı açar, ölçüm ve ekran görüntüsü toplar.
// Yalnız okuma yapar: sayfada hiçbir kayıt / düğme tıklanmaz, canlı veriye yazılmaz.
// Kullanım (çalışma klasöründe Playwright kurulu olmalı):  node gorus.mjs <cikti-klasoru> <senaryo.json>
// Ortam: OTONOM_BASE_URL, OTONOM_TEST_KULLANICI, OTONOM_TEST_PAROLA (test hesabı; sır repoda tutulmaz).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(path.join(process.cwd(), 'gorus.js'))
const { chromium } = require('playwright')

const [, , cikti, senaryoYolu] = process.argv
if (!cikti || !senaryoYolu) {
  console.error('kullanım: node gorus.mjs <cikti-klasoru> <senaryo.json>')
  process.exit(2)
}
const { BASE_URL, KULLANICI, PAROLA } = {
  BASE_URL: process.env.OTONOM_BASE_URL,
  KULLANICI: process.env.OTONOM_TEST_KULLANICI,
  PAROLA: process.env.OTONOM_TEST_PAROLA,
}
if (!BASE_URL || !KULLANICI || !PAROLA) {
  console.error('OTONOM_BASE_URL, OTONOM_TEST_KULLANICI, OTONOM_TEST_PAROLA ortam değişkenleri gerekli')
  process.exit(2)
}

const senaryolar = JSON.parse(fs.readFileSync(senaryoYolu, 'utf8'))
fs.mkdirSync(cikti, { recursive: true })

// Sayfa içi ölçümler: görünür yazı boyutları, etkileşim öğeleri, başlıklar, metin özeti.
// Bu fonksiyon tarayıcıda çalışır; dışarıdan bir değişken kullanmaz.
const olcum = () => {
  const gorunur = (el) => {
    const r = el.getBoundingClientRect()
    const st = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'
  }
  const yazili = [...document.querySelectorAll('body *')].filter(
    (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && gorunur(el),
  )
  const boyutlar = yazili.map((el) => parseFloat(getComputedStyle(el).fontSize))
  const etkilesim = [...document.querySelectorAll('button, a[href], input, select, textarea')].filter(gorunur)
  return {
    yaziSayisi: yazili.length,
    enKucukYaziPx: boyutlar.length ? Math.min(...boyutlar) : null,
    kucukYaziSayisi: boyutlar.filter((b) => b < 12).length,
    etkilesimSayisi: etkilesim.length,
    basliklar: [...document.querySelectorAll('h1, h2, h3')].filter(gorunur).slice(0, 12).map((h) => h.innerText.trim().slice(0, 80)),
    metinOzeti: (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 3000),
  }
}

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const sayfa = await browser.newPage({ viewport: { width: 1440, height: 900 } })

// Giriş: ad + parola (LoginGate). Oturum açılmazsa pilot durur.
await sayfa.goto(BASE_URL, { waitUntil: 'networkidle' })
if (await sayfa.locator('input[type="password"]').count()) {
  await sayfa.locator('input[autocomplete="username"]').first().fill(KULLANICI)
  await sayfa.locator('input[type="password"]').first().fill(PAROLA)
  await sayfa.getByRole('button', { name: /sign in/i }).click()
  await sayfa.waitForLoadState('networkidle')
}
if (await sayfa.locator('input[type="password"]').count()) {
  console.error('giriş yapılamadı: test hesabını ve OTONOM_TEST_* değerlerini kontrol et')
  await browser.close()
  process.exit(1)
}

for (const s of senaryolar) {
  const etiket = s.rol.replace(/\s+/g, '-').toLowerCase()
  const t0 = Date.now()
  await sayfa.goto(BASE_URL + s.sayfa, { waitUntil: 'networkidle' })
  const yuklemeSn = (Date.now() - t0) / 1000
  await sayfa.screenshot({ path: path.join(cikti, `${etiket}.png`) })
  const veri = { rol: s.rol, sayfa: s.sayfa, gorev: s.gorev, yuklemeSn, ...(await sayfa.evaluate(olcum)) }
  fs.writeFileSync(path.join(cikti, `${etiket}.json`), JSON.stringify(veri, null, 1))
  console.log(`tamam: ${s.rol} (${s.sayfa}) — en küçük yazı ${veri.enKucukYaziPx}px`)
}
await browser.close()
