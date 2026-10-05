# Güvenlik yapısı

Kısa özet: kim girer, neyi görebilir, kim neyi değiştirebilir, ne kaydedilir.
Ayrıntı kodda; her maddenin dosyası yanında.

## Giriş ve oturum

| Konu | Nasıl | Dosya |
|---|---|---|
| Parola saklama | PBKDF2-HMAC-SHA512, 210 000 tekrar, kullanıcıya özel tuz; düz parola hiçbir yere yazılmaz. Eski (120 000) karmalar ilk girişte fark ettirmeden yükseltilir | convex/auth.ts |
| Karşılaştırma | Sabit süreli (`timingSafeEqual`) | convex/auth.ts |
| Kullanıcı adı tahmini | Var olmayan / pasif kullanıcıda da aynı karma işi yapılır, aynı mesaj döner | convex/auth.ts |
| Parola kuralı | En az 8 karakter, harf + rakam, kullanıcı adı / varsayılan olamaz | src/lib/authRules.ts |
| Kaba kuvvet | Art arda 5 hata → 15 dk kilit; kayda düşer; creator yeni parola verince kalkar | convex/authInternal.ts |
| Oturum jetonu | 32 rastgele bayt; veritabanında **yalnızca SHA-256 karması** — yedek sızsa da oturum açılamaz | convex/sessionStore.ts |
| Oturum ömrü | 12 saat; parola değişince diğer cihazlar kapanır; pasif kullanıcının jetonu çalışmaz; süresi dolanlar her gece silinir | src/lib/authRules.ts, convex/tenancy.ts |
| Oturumu kapatma | Kullanıcı: My account → "Sign out the other devices". Yönetici: Users & permissions → "Sign out everywhere" (kayda düşer) | convex/users.ts |
| Son giriş | Kullanıcı başına son başarılı giriş; uzun süre girmeyen hesap görünür | convex/authInternal.ts |

## Yetki

- Her sunucu işlevi oturumu kendisi denetler; muaf olanlar listelidir ve testle korunur (convex/authGuard.test.ts).
- Veri plant'e kilitlidir: işlev yalnızca oturumun seçili plant'inin kayıtlarını görür (convex/plantDb.ts).
- İzin **alan** bazında: modül → alan (Plan & rules, Master data, Work calendar …); her yazma işlevi alanını söyler (testle zorunlu).
- "Kim yaptı" alanları (`reportedBy`, `solvedBy`, `createdBy`, `author` …) sunucuda oturumdan yazılır; tarayıcının gönderdiği ad yok sayılır (src/lib/authorFields.ts).

## Tarayıcı ve sunucu başlıkları

Her cevapta (src/lib/securityHeaders.ts, Nitro): CSP (dış betik yok, veri yalnızca kendi sunucumuza ve Convex'e, `object` yok, başka sitede çerçeve yok), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS.

## Dosyalar

- Fotoğraf: yalnızca JPEG / PNG / WebP / GIF / HEIC, en çok 15 MB ve 10 adet; uymayan depodan silinir (convex/uploads.ts).
- Excel: yalnızca kullanıcının tarayıcısında okunur; 25 MB sınırı, formül / HTML / makro okunmaz (src/lib/safeExcel.ts).

## Kayıt

- Denetim kaydı (auditLog): şirket, plant, kullanıcı, grup, parola, kilit, oturum kapatma — eski → yeni değer, kim, ne zaman.
- E-posta servisi anahtarı kodda ve veritabanında değil, Convex ortam değişkeninde.

## Açık konular

`todolist.md` → 4.3.
