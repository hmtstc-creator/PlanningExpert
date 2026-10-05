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
| Parola püskürtme | Kullanıcıdan bağımsız sayaç: son 30 dakikada 30 / 100 / 300 hatalı giriş → **her** giriş 1 / 3 / 5 sn bekler; eşik aşılınca denetim kaydına `signin.pressure`. Var olmayan ad ve kilitli hesap denemesi de sayılır. Ad ya da parola yazılmaz, yalnızca sayılar (10 dk dilim, 30 gün saklanır) | src/lib/signinGuard.ts, convex/authInternal.ts |
| Sızmış parola | Yeni parola (kendi değişikliği, yöneticinin verdiği, panelden sıfırlama) bilinen sızıntılarda geçiyorsa reddedilir. Have I Been Pwned'e yalnızca SHA-1 karmasının ilk 5 hanesi gider (k-anonimlik); servis 3 sn içinde cevap vermezse parola reddedilmez. Kapatmak: Convex ortam değişkeni `PWNED_CHECK=off` | src/lib/pwned.ts, convex/auth.ts |

## Yetki

- Her sunucu işlevi oturumu kendisi denetler; muaf olanlar listelidir ve testle korunur (convex/authGuard.test.ts).
- Veri plant'e kilitlidir: işlev yalnızca oturumun seçili plant'inin kayıtlarını görür (convex/plantDb.ts).
- İzin **alan** bazında: modül → alan (Plan & rules, Master data, Work calendar …); her yazma işlevi alanını söyler (testle zorunlu).
- "Kim yaptı" alanları (`reportedBy`, `solvedBy`, `createdBy`, `author` …) sunucuda oturumdan yazılır; tarayıcının gönderdiği ad yok sayılır (src/lib/authorFields.ts).

## Tarayıcı ve sunucu başlıkları

Her cevapta (src/lib/securityHeaders.ts, Nitro): CSP (dış betik yok, veri yalnızca kendi sunucumuza ve Convex'e, `object` yok, başka sitede çerçeve yok), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS, `X-Robots-Tag: noindex`.

Arama motorları: `robots.txt` her yolu kapatır ve başlık dizine almayı yasaklar — giriş sayfası Google'da çıkmaz, saldırgan siteyi aramayla bulamaz.

## Dosyalar

- Fotoğraf: yalnızca JPEG / PNG / WebP / GIF / HEIC, en çok 15 MB ve 10 adet; uymayan depodan silinir (convex/uploads.ts).
- Sahipsiz yükleme: yükleme adresi alınıp hiçbir arıza / kalıp problemine bağlanmayan dosya 24 saat sonra her gece silinir (depoyu doldurma denemesi ve vazgeçilen raporlar). Tablo taranamayacak kadar büyükse hiçbir şey silinmez; bir gecede en çok 200 dosya (convex/tenancy.ts `purgeOrphanUploads`).
- Excel: yalnızca kullanıcının tarayıcısında okunur; 25 MB sınırı, formül / HTML / makro okunmaz (src/lib/safeExcel.ts).

## Güvenlik ekranı

- Administration → **Security** (General, bütün site): kilitli hesaplar, 90+ gün kullanılmayan yönetici ve diğer hesaplar, değiştirilmemiş geçici parolalar, geniş yetkili hesaplar, açık oturum sayısı, hatalı giriş sayıları (24 saat / 7 gün, var olmayan adla deneme), şu anki giriş beklemesi ve son güvenlik olayları.
- Users & permissions → **Security check** (creator): aynısı, yalnızca kendi şirketi (site geneli giriş sayıları hariç).
- Kural: src/lib/securityOverview.ts. Son giriş 2026-10-05'ten beri yazıldığı için "kullanılmıyor" uyarısı en erken 90 gün sonra çıkar.

## Kayıt

- Denetim kaydı (auditLog): şirket, plant, kullanıcı, grup, parola, kilit, oturum kapatma — eski → yeni değer, kim, ne zaman.
- E-posta servisi anahtarı kodda ve veritabanında değil, Convex ortam değişkeninde.

## Açık konular

`todolist.md` → 4.3.
