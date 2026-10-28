---
name: qwen
description: Mekanik bir hatanın (tip hatası, kırık test, bozuk import) düzeltme döngüsünü ücretsiz Qwen'e yaptırmak ve sonucunu az tokenle okuyup karar vermek için. verify kırmızı ve hata mekanikse, kendin düzeltmeye başlamadan önce kullan.
---

# Qwen standardı — iş Qwen'de, Claude yalnız rapor okur ve karar verir

Kullanıcı kararı 2026-10-28: mekanik düzeltme döngüsü Claude'un bağlamını yemesin; Qwen yazar, **son söz Claude'undur**.
Altyapı: `.github/workflows/qwen-yesil.yml` → `scripts/qwen-yesil.sh`, Qwen'in kuralları `QWEN.md`.

## 1. Ne zaman Qwen'e verilir

| Qwen'e ver | Kendin yap / `derin` |
|---|---|
| `error TS…` tip hataları, bozuk import, yeniden adlandırma sonrası kırıklar | Motor, doğrulayıcı, OEE, şema, `planlogic.tsx` (korunan yollar — Qwen dokunamaz) |
| Mantığı değişmemiş kodda kırılan var olan test | Davranışı değiştiren iş, yeni özellik, tasarım |
| Hata ≥ 3 dosyaya yayılmış ya da ilk denemen tutmadı | Tek satırlık, yeri belli hata (Qwen turu daha pahalı) |

Kural: verify çıktısını yalnız `npm run verify 2>&1 | grep -E "error TS|FAIL|✗" | head -20` ile oku; mekanikse **kendin
döngüye girme**, Qwen'e ver.

## 2. Tetikleme (tek çağrı)

1. Değişikliklerini commit'le ve PR dalını it (Qwen dalın son commit'ini görür).
2. PR'a `qwen` etiketi ekle (`mcp__github__issue_write`, `labels` listesine `qwen` ekle — var olanları silme).
   PR yoksa: `mcp__github__actions_run_trigger` → `qwen-yesil.yml`, girdi `dal=<dal>`.
3. Turu bitir. **Bekleme, yoklama yapma, iş günlüğü (job log) okuma.** Rapor PR'a yorum olarak düşer ve PR aboneliği
   oturumu uyandırır.

## 3. Raporu okuma (tek kaynak: `qwen-rapor.md` yorumu)

Rapor kısadır: sonuç başlığı + `git diff --stat` + Qwen'in son sözü. Tam fark rapora **yazılmaz**.
Job log'u yalnız rapor hiç gelmediyse ve iş kırmızıysa oku, o da `get_job_logs` ile son 40 satır.

| Rapor başlığı | Yapılacak |
|---|---|
| `zaten yeşil` | Hiçbir şey; etiketi kaldır. |
| `Sonuç: yeşil — Claude'un onayı bekleniyor` | §4 gözden geçirme. |
| `Durduruldu: korunan dosyalara dokunuldu` | Düzeltme mimari alanda: kendin yap ya da `derin`. Qwen'i tekrar tetikleme. |
| `Durduruldu: dosya silindi` / `fazla büyük` | Hata mekanik değil; kendin ele al. |
| `verify yeşile dönmedi` | Kalan hatalara bak; ikinci kez **tetikleme**, kendin bitir (en çok 1 Qwen denemesi / iş). |
| `Anahtar yok` / Qwen hata verdi | Kullanıcıya tek satır: `QWEN_API_KEY` gizli değeri ya da sağlayıcı sorunu. Kendin düzelt. |

## 4. Final kontrol (yeşil rapor)

```
git fetch -q origin qwen/<dal>
git diff --stat HEAD origin/qwen/<dal>          # önce yalnız özet
git diff HEAD origin/qwen/<dal> -- <dosya>      # sonra yalnız şüpheli dosya(lar)
```

Kabul ölçütü — hepsi evet olmalı:
- Değişiklik yalnız hatanın düzeltmesi mi (davranış, metin, varsayılan değer değişmemiş)?
- Test zayıflatılmamış mı (beklenen değer değiştirilmemiş, `skip` / silinmiş `expect` yok)?
- `any`, `@ts-ignore`, `as unknown as` ile hata susturulmamış mı?
- Katman yönü korunmuş mu (saf hesap dosyasına Convex / arayüz importu yok)?

Evet → `git merge --squash origin/qwen/<dal>` (ya da yalnız iyi dosyaları `git checkout origin/qwen/<dal> -- <dosya>`),
`npm run verify 2>&1 | tail -20`, kendi commit'inle it. Hayır → alma, nedenini PR'a tek satır yaz, kendin düzelt.
Her iki durumda `qwen` etiketini kaldır; `qwen/<dal>` dalı PR birleşince ayrıca silinmez, `git push origin :qwen/<dal>` ile sil.

## 5. Token bütçesi

- Bir Qwen turu Claude'a ≈ 1 PR yorumu (~40 satır) + `diff --stat` + en çok 1–2 dosya farkı mal olmalı.
- Rapor ya da fark 150 satırı aşıyorsa okuma; değişiklik zaten sınır dışıdır, reddet.
- `Qwen: verify yeşile çevir` kontrolü zorunlu değildir; kırmızı görünmesi PR'ın CI'ını (`verify`) bozmaz, onu düzeltmeye çalışma.
