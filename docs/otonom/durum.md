# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-0540 · src/routes/oee/bridge.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/bridge.tsx'in ilk 220 satırı incelendi. Dönem, vardiya ve makine filtreleri tek hesap yolunda birleşiyor; parça ve neden kırılımları ile Die Follow-up'a takip konusu açma akışı tutarlı görünüyor. Sayfanın 826 satırlık geri kalanı bu toplantıda okunmadı. Ciddi bir hata bulunmadığı için yazılacak görev
- 20261102-0440 · src/routes/oee/asakai-weekly.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/asakai-weekly.tsx'in ilk 220 satırı incelendi. Sayfa, bugünü hesaba katmayıp en son dünü gösteriyor ve bu kuralı üst bilgi metninde açıklıyor. Masraf yerinin tüm iş yerleri satır olarak gösteriliyor, hafta ve ay hesapları aynı kaynaktan geliyor. Planlama mantığında, veri akışında veya katman i
- 20261102-0340 · src/routes/oee/asakai-detail.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/asakai-detail.tsx'in ilk 220 satırı incelendi. Sayfa günü, dünü en son gün sayacak şekilde sınırlıyor ve bu kuralı üst bilgi metninde açıklıyor. Tüm iş yerlerini (masraf yeri sırasıyla) satır olarak gösterdiği, sütun ve satır sayılarının tutarlı olduğu görüldü. Bu bölümde planlama veya katman 

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Bridge sayfasının üst bilgi metni uzun; vardiya amiri için ilk satıra 'Red = en büyük kayıp' gibi tek satırlık bir özet konabilir. Arayüz metni değiştiği için kullanıcı onayı gerekir.
- Bridge sayfasından /oee/losses ve /oee/mttr'a giden bağlantılar var ama /oee/asakai-detail'a yok; kayıp sayfasından Asakai günlük ekranına relatedPages ile geçiş eklenirse vardiya amiri iki görünüm arasında tek tıkla geçer. Arayüz kararı kullanıcıya sorulmalı.
- Parça ve neden satırlarında OEE/dakika birimi yalnız başlıkta; hücrelere birim eklenmesi okunabilirliği artırır. Görsel değişiklik olduğu için kullanıcı onayı gerekir.
- Sayfanın kalan 606 satırı (Level 3 tablosu ve grafikler) bir sonraki toplantıda odaklanılmalı; gerçek ekran boyutunda ilk yüklemede 'Loading' yerine dolu tablo görünümü tarayıcıyla doğrulanmalı.
- Bridge ile Die Follow-up arasında takip konusu açma akışı var; açılan konunun Die Follow-up'ta görünüp görünmediği ve geri dönüş bağlantısının olup olmadığı salt okuma ile kontrol edilmeli.
- Asakai haftalık ve günlük sayfaları arasında doğrudan bağlantı yok; relatedPages ile /oee/asakai-detail bağlantısı eklenirse vardiya amiri iki sayfa arasında tek tıkla geçer. Arayüz kararı, kullanıcı onayı gerekir.
- Üst bilgi metni (info) üç uzun paragraf; vardiya amiri için 30 saniyede okunabilmesi adına ilk satıra 'Red = en büyük kayıplar' gibi tek satırlık bir özet konabilir. Arayüz metni, kullanıcı onayıyla değiştirilmeli.
- Gerçek ekran boyutunda ilk görünümde tablonun 'Loading…' yerine dolu gösterildiği bir kez kontrol edilmeli (tarayıcıyla doğrulama gerekir).
- Iş yeri satırlarında OEE ve Loading değerlerinin birimi (% ve dakika) yalnız başlıkta; hücrelere birim etiketi eklemek okunabilirliği artırır. Görsel değişiklik, kullanıcı onayı gerekir.
- Info metni 'OEE Settings → Agent Report and Loss groups' bölümlerine atıf yapıyor; oee/settings sayfasında bu bölümlerin varlığı salt okuma ile doğrulanmalı.
