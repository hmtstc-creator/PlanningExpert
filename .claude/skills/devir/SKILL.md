---
name: devir
description: İş bitince (PR birleşince) ya da bağlam ~%40'ı geçince kullan. Bilgiyi wiki'ye yazar ve kullanıcıya yeni oturum açmasını söyler; yeni oturum kaldığı yerden devam eder.
---

# Devir — oturumu kapat, bilgiyi depoya yaz

Amaç: bu sohbette öğrenilen hiçbir şey kaybolmasın, sonraki oturum yalnız depoyu okuyarak devam edebilsin.

1. **Sürüm günlüğü:** birleşen her PR için `docs/wiki/08-surum-gunlugu.md` tablosunun en üstüne bir satır
   (PR no, tarih, ne, neden). Zaten varsa atla.
2. **Kararlar ve dersler:** bu oturumda alınan karar → `docs/wiki/11-karar-gunlugu.md` (iş kararıysa
   `docs/decisions.md`); öğrenilen tuzak → ilgili wiki sayfası. Sayfanın *Son güncelleme* satırını değiştir.
3. **Yarım kalan iş:** `docs/wiki/09-acik-konular.md`'ye "Devam" maddesi: dal adı, açık PR, sıradaki adım
   (tek cümle), dikkat edilecek dosya ve satır aralığı. Kullanıcı işi → `todolist.md` ilgili bölüm.
4. Bunlar bir docs PR'ı olarak gider (`[logic-docs: n/a] yalnız wiki`), CI yeşil → squash merge.
5. Kullanıcıya yalnız şunu yaz (en fazla 5 satır):
   - ne bitti (1–2 madde),
   - "**Yeni oturum aç** ve şunu yaz:" + kopyalanabilir tek satır, ör.
     `/yeni-is 09-acik-konular → Devam: <konu>`.

Bu oturumda başka iş başlatma; yeni iş yeni oturumda başlar.
