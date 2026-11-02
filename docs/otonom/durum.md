# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-0440 · src/routes/oee/asakai-weekly.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/asakai-weekly.tsx'in ilk 220 satırı incelendi. Sayfa, bugünü hesaba katmayıp en son dünü gösteriyor ve bu kuralı üst bilgi metninde açıklıyor. Masraf yerinin tüm iş yerleri satır olarak gösteriliyor, hafta ve ay hesapları aynı kaynaktan geliyor. Planlama mantığında, veri akışında veya katman i
- 20261102-0340 · src/routes/oee/asakai-detail.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/asakai-detail.tsx'in ilk 220 satırı incelendi. Sayfa günü, dünü en son gün sayacak şekilde sınırlıyor ve bu kuralı üst bilgi metninde açıklıyor. Tüm iş yerlerini (masraf yeri sırasıyla) satır olarak gösterdiği, sütun ve satır sayılarının tutarlı olduğu görüldü. Bu bölümde planlama veya katman 
- 20261102-0240 · src/routes/oee/agent.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/agent.tsx'in 220 satırı incelendi. Sayfa, OEE verisini ve açık konuları tek bir rapor fonksiyonuna (agentReport) veriyor; rapor günü, veri sonu tarihine göre kırpılıyor ve bu durum bir uyarı metniyle gösteriliyor. Kalıp ve makine konuları yalnızca ilgili izinler varsa okunuyor, sunucu tarafı izin kont

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Asakai haftalık ve günlük sayfaları arasında doğrudan bağlantı yok; relatedPages ile /oee/asakai-detail bağlantısı eklenirse vardiya amiri iki sayfa arasında tek tıkla geçer. Arayüz kararı, kullanıcı onayı gerekir.
- Üst bilgi metni (info) üç uzun paragraf; vardiya amiri için 30 saniyede okunabilmesi adına ilk satıra 'Red = en büyük kayıplar' gibi tek satırlık bir özet konabilir. Arayüz metni, kullanıcı onayıyla değiştirilmeli.
- Gerçek ekran boyutunda ilk görünümde tablonun 'Loading…' yerine dolu gösterildiği bir kez kontrol edilmeli (tarayıcıyla doğrulama gerekir).
- Iş yeri satırlarında OEE ve Loading değerlerinin birimi (% ve dakika) yalnız başlıkta; hücrelere birim etiketi eklemek okunabilirliği artırır. Görsel değişiklik, kullanıcı onayı gerekir.
- Info metni 'OEE Settings → Agent Report and Loss groups' bölümlerine atıf yapıyor; oee/settings sayfasında bu bölümlerin varlığı salt okuma ile doğrulanmalı.
- Sayfa başlığı ve metinler İngilizce, toplantı notları Türkçe; arayüz dili tutarlılığı kullanıcı onayıyla gözden geçirilebilir.
- Makineler sayfası ve Hall/Stop açıklama bileşenleri büyük (1324 satır); components/ altına taşınması ilişki okumayı kolaylaştırır ama büyük yeniden düzenleme olduğu için kullanıcı onayı gerekir.
- HallInfo metni 'Work Calendar page' diyor; /takvim ile eşleşip eşleşmediği doğrulanıp bağlantı eklenirse sayfa geçişi kolaylaşır (rota bağlantısı, kullanıcı onayı).
- Sayfada /oee/asakai-weekly ile /oee/asakai-detail arasında doğrudan bağlantı yok; ilgili sayfa bağlantısı (relatedPages) eklenirse vardiya amiri haftalık ve günlük Asakai arasında geçişi tek tıkla yapar. Arayüz kararı, kullanıcı onayı gerekir.
- Üst bilgi metni (info) üç uzun paragraf; vardiya amiri için 30 saniyede okunabilir olması adına kısaltılabilir veya ilk satır olarak 'Red = en büyük 6 duruş' gibi tek satırlık bir özet öne alınabilir. Arayüz metni, kullanıcı onayıyla değiştirilmeli.
