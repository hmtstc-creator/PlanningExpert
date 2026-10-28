# PlanningExpert — Qwen için çalışma kuralları

Bu dosya `scripts/qwen-yesil.sh` ile GitHub Actions'ta çalışan Qwen oturumu içindir.
Claude'un kuralları `CLAUDE.md`'dedir; çelişki olursa `CLAUDE.md` üstündür.

## Senin işin

`npm run verify` (typecheck + vitest + vite build) kırmızıysa **yeşile çevirmek**. Hepsi bu.

- Yalnız derlemenin ve var olan testlerin geçmesi için gerekeni düzelt.
- Davranışı değiştirme, yeniden tasarlama, düzeltmenin ötesinde temizlik yapma.
- **Testi zayıflatarak ya da silerek geçirme.** Test doğruyu söylüyor; kodu düzelt.
- Yeni bağımlılık ekleme.
- Mevcut kod biçimini koru. Bu depoda yorumlar ve kullanıcıya görünen metinler Türkçedir.

## Sınırların

Yazdığın hiçbir şey doğrudan çalışma dalına girmez. Düzeltmelerin ayrı bir dala
(`qwen/<dal>`) iter; oradan çalışma dalına **yalnız Claude** okuyup karar vererek alır.
Son söz Claude'undur.

**1. Dokunmaman gereken dosyalar.** Dokunursan iş durur, hiçbir değişiklik itilmez:

- Motor ve mimari: `src/lib/planPipeline.ts`, `scheduler.ts`, `planValidator.ts`,
  `planning.ts`, `oee.ts`, `architecture.test.ts`, `src/routes/planlogic.tsx`,
  `convex/schema.ts`, `convex/oee.ts`
- Bağımlılık ve yapılandırma: `package.json`, `package-lock.json`, `tsconfig.json`,
  `vite.config.ts`, `vitest.config.ts`
- Altyapı ve belge: `.github/`, `scripts/`, `deploy/`, `docs/`, `CLAUDE.md`,
  `QWEN.md`, `.gitignore`

Tek çözüm bu dosyaların içindeyse **dur ve nedenini yaz**; düzeltmeyi Claude yapar.

**2. Dosya silemez, yeniden adlandıramazsın.**

**3. Boyut sınırı:** en fazla 10 dosya ve 300 değişen satır. Aşarsan iş durur —
o boyut mekanik düzeltme değil, yeniden yazma demektir.

## Mimarinin bilmen gereken kadarı

- Katman yönü denetlenir (`src/lib/architecture.test.ts`): saf hesap dosyaları
  Convex'e ya da arayüze bağımlı olamaz. Bir import eklerken yönü ters çevirme.
- Planlama mantığı değişirse `src/routes/planlogic.tsx` de değişmeli
  (`scripts/check-logic-docs.sh` denetler). Sen mantığa dokunmadığın için bu
  senin işin değil; mantık değişikliği gerekiyorsa dur.
- Kalıcı hafıza `docs/wiki/`'dedir. Sen wiki yazmazsın.

## Çıktı

Kısa ol. Ne bozuktu, ne yaptın, kaç dosya değişti — birkaç satır. Kod dökümü yapma.
Gizli değer (anahtar, jeton, parola) hiçbir çıktıya yazılmaz.
