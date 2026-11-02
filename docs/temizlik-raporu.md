# Temizlik raporu — kişisel bilgi ve bot izleri (2026-11-02)

**Amaç:** Program başka bir GitHub organizasyonunun altına kopyalanmadan önce depoda kişisel
bilgi ve sunucudaki bot bilgisi kalmasın. VPS bağlantı kalıpları (adres şablonu, yollar, servis
adları) bilerek kaldı. Bu rapor da kişisel bilgi içermez.

**Yöntem:** Depodaki bütün izlenebilir dosyalar (kod, betik, test, belge, yapılandırma) tarandı:
isim, e-posta, kullanıcı adı, konum, IP, sağlayıcı adı, bot adı ve bot kaynak gerekçeleri. Her
bulgu ya kuralla değiştirildi ya da bilerek bırakıldı (aşağıda).

## 1. Ne bulundu, ne yapıldı

| Tür | Nerede | Yapılan |
|---|---|---|
| Sahibin adı | deploy kitabı, karar kayıtları, wiki, kod yorumları, test verisi | "site sahibi" yazıldı; test verisi "kisi" yapıldı |
| GitHub kullanıcı adı | derleme sabiti, otonom betikleri, kurulum kitabı | Sabit ad kaldırıldı; ortam değişkenine çevrildi (4. kural) |
| Kişinin bulunduğu ülke | wiki sürüm günlüğü | Cümle kaldırıldı; saat dilimi kaydı kaldı |
| Sunucudaki başka bot uygulaması (ad, dizin, servis, kapsayıcı, kapı, güvenlik duvarı kuralı) | deploy kitabı, compose dosyası, deploy betiği, dokümanlar | Kaldırıldı; yerine 2. kural yazıldı |
| Bota ayrılan bellek ve bot gerekçeleri | deploy kitabı, compose, `.env` örneği, yorumlar | Gerekçe kaldırıldı; yerine 3. kural yazıldı |
| VPS sağlayıcı adı ve plan bilgisi | README, kitap, wiki, yedek betiği | "VPS" yazıldı |

Değişen dosya sayısı: 28 (`git diff --stat`). Program davranışı değişmedi; yalnızca iki yeni ortam
değişkeni eklendi ve her biri varsayılanı boş olan bir yer tutucudur.

## 2. Yerine konan kurallar

Bu bilgiler silindiğinde sistemin doğru çalışması için yeni organizasyonda uygulanacak kurallar:

1. **Sahip:** Belgelerde isim yerine rol yazılır ("site sahibi"). Karar yetkisi roldedir.
2. **Sunucudaki diğer uygulamalar:** PlanningExpert onların kapsayıcılarına, servislerine, güvenlik
   duvarı kurallarına ve kapılarına dokunmaz. Program yalnızca `/opt/planningexpert` dizinini ve
   `planningexpert` compose projesini kullanır. Deploy betiğinde diğer kapsayıcıları sayan satır
   kaldırıldı; bu satır betiğin çalışmasını etkilemiyordu.
3. **Bellek:** Program sunucuda **X GB** bellek izniyle çalışır. Kapsayıcı sınırlarının toplamı bu
   izni aşmaz (backend 1200 MB, site 384 MB, Tailscale 128 MB). `X` değeri her sunucuda kendi
   kapasitesine göre yazılır. Deploy öncesi "boş bellek en az 1 GB" kontrolü aynen duruyor.
4. **GitHub adı:** Üç yerde ayarlanır, kodda sabit ad yoktur:
   - Derleme: `VITE_REPO_URL` (`scripts/release.sh` geçirir). Boş kalırsa sürüm bağlantıları çalışmaz.
   - Otonom betikler: `/etc/otonom/env` içinde `REPO_SLUG=<organizasyon>/PlanningExpert`.
   - Otonom kurulumu: `OTONOM_CLONE_URL=https://github.com/<organizasyon>/PlanningExpert.git`
     (`scripts/otonom/kur.sh` bu değişken yoksa durur).
5. **VPS bağlantısı:** Adres şablonu (`planningexpert.<tailnet>.ts.net`), `/opt/planningexpert` ve
   `/home/otonom` gibi yollar kalır. Gerçek adres ve anahtarlar yalnızca sunucudadır.

## 3. Bilerek kalan öğeler

- **Saat dilimi `Europe/Bucharest`** ve testlerdeki "Romanya" yorumları: fabrikanın saat dilimi,
  işlevsel bir ayar. Kişinin konumu değildir.
- **Test ve örnek verilerindeki fabrika adı** (ör. "Romanya Martur"): şirket verisi, kişisel değil.
  Yeni organizasyonda genel bir adla değiştirilebilir.
- **Otonom geliştirme sistemi:** Program özelliği olarak kaldı (`scripts/otonom/`, `deploy/systemd/`).
  Bot adı ya da bot kaynağı içermez. Sunucuda çalışan başka bir bot olarak değerlendirilip
  kaldırılmasını isterseniz söylenir.
- **Sürüm ve karar kayıtlarındaki PR numaraları ve tarihler:** Program geçmişidir.

## 4. Açık kalanlar (karar gerekiyor)

- **Git geçmişi (önemli):** Depodaki 50 commit'in yazarı sahibin kişisel e-posta adresi. Geçmiş
  olduğu gibi kopyalanırsa bu adres yeni organizasyonda da görünür. Seçenekler:
  - **(a) Önerilen:** Yeni organizasyona tek bir başlangıç commit'iyle kopyalamak. Geçmiş dışarıda kalır.
  - **(b)** Geçmişi yeniden yazmak. Bu, zorla gönderim (force push) gerektirir; onay istenir.
  - Bu commit'lerin kimliği ve geçmişteki kayıtlar bu PR'dan değiştirilmedi.
- **`deploy/.env.example`:** Bu dosya oturum izinleri nedeniyle okunamadı. Yalnızca bellek yorum
  satırı değiştirildi. Yeni organizasyondan önce elle kontrol edilmeli.
- **`X GB` değeri ve iki ortam değişkeni** (`VITE_REPO_URL`, `REPO_SLUG`, `OTONOM_CLONE_URL`) yeni
  sunucuda doldurulmalı.

## 5. Doğrulama

- `npm run verify`: 140 test dosyası, 1289 test geçti. `scripts/check-logic-docs.sh` temiz
  (planlama mantığı dosyası değişmedi).
- Son tarama: sahibin adı, GitHub kullanıcı adı, e-posta kalıpları, bot adı, sağlayıcı adı ve IP
  adresleri depoda kalmadı. Tek istisna bu rapor ve sürüm günlüğünde "bot izleri" ifadesidir; bu
  bir kayıt kelimesidir, bot bilgisi değildir.
