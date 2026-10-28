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

## Dokunmaman gereken dosyalar

Bunlar planlama motorunun çekirdeği ve mimari korumalarıdır; değişiklikleri mimari
karar ister. Dokunursan iş durur ve hiçbir değişiklik itilmez:

- `src/lib/planPipeline.ts`, `src/lib/scheduler.ts`, `src/lib/planValidator.ts`
- `src/lib/planning.ts`, `src/lib/oee.ts`, `convex/oee.ts`
- `src/lib/architecture.test.ts`, `convex/schema.ts`
- `src/routes/planlogic.tsx` (Planning Logic sayfası)
- `CLAUDE.md`, `QWEN.md`, `.github/workflows/`, `scripts/qwen-yesil.sh`

Tek çözüm bu dosyaların içindeyse **dur ve nedenini yaz**; düzeltmeyi Claude yapar.

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
