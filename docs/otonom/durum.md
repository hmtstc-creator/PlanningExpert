# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-0340 · src/routes/oee/asakai-detail.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/asakai-detail.tsx'in ilk 220 satırı incelendi. Sayfa günü, dünü en son gün sayacak şekilde sınırlıyor ve bu kuralı üst bilgi metninde açıklıyor. Tüm iş yerlerini (masraf yeri sırasıyla) satır olarak gösterdiği, sütun ve satır sayılarının tutarlı olduğu görüldü. Bu bölümde planlama veya katman 
- 20261102-0240 · src/routes/oee/agent.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/agent.tsx'in 220 satırı incelendi. Sayfa, OEE verisini ve açık konuları tek bir rapor fonksiyonuna (agentReport) veriyor; rapor günü, veri sonu tarihine göre kırpılıyor ve bu durum bir uyarı metniyle gösteriliyor. Kalıp ve makine konuları yalnızca ilgili izinler varsa okunuyor, sunucu tarafı izin kont
- 20261102-0140 · src/routes/makineler.tsx · degisiklik-yok: Toplantı odağı src/routes/makineler.tsx'in ilk 220 satırıydı. Work center ağacı, Hall (setup crane) ve Frekansiyel duruş açıklamaları planlama kurallarını sayfada anlatıyor; bu metinlerin planlogic.tsx ile çelişip çelişmediği bu incelemede doğrulanamadı. Planlama mantığında, veri akışında ya da katman ihlalinde kesin bir hata bulunmadı. 

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Sayfada /oee/asakai-weekly ile /oee/asakai-detail arasında doğrudan bağlantı yok; ilgili sayfa bağlantısı (relatedPages) eklenirse vardiya amiri haftalık ve günlük Asakai arasında geçişi tek tıkla yapar. Arayüz kararı, kullanıcı onayı gerekir.
- Üst bilgi metni (info) üç uzun paragraf; vardiya amiri için 30 saniyede okunabilir olması adına kısaltılabilir veya ilk satır olarak 'Red = en büyük 6 duruş' gibi tek satırlık bir özet öne alınabilir. Arayüz metni, kullanıcı onayıyla değiştirilmeli.
- Sayfanın ilk 220 satırında en çok kullanılan bilgi (OEE ve Loading time) ekranın üst kısmında; gerçek ekran boyutunda ilk görünümün 'Loading…' yerine dolu tablo gösterdiği bir kez kontrol edilmeli.
- İş yeri ve vardiya satırlarında 'OEE' ve 'Loading' değerlerinin birimi (% ve dakika) yalnız başlıkta ve hücrelerin biçiminde belli; birim etiketi eklemek okunabilirliği artırır. Görsel değişiklik, kullanıcı onayı gerekir.
- Sayfanın bilgi metni (info) 'OEE Settings → Agent Report and Loss groups' bölümlerine bağlanıyor; oee/settings sayfasında bu iki bölümün gerçekten bulunduğu salt okuma ile doğrulanmalı, yoksa kullanıcı 30 saniyelik kullanımda yanlış yere gider.
- Rapor 'Critical / Warning / Watch / Good news' sınıflarını ve eşikleri oeeAgent.ts'ten üretiyor; bu eşik değerlerinin Planning Logic sayfasında (planlogic.tsx) anlatılıp anlatılmadığı kontrol edilmeli. Korunan alan olduğu için yalnız okuma incelemesi, kullanıcı onayıyla.
- Sayfadaki arayüz metinleri İngilizce, PDF başlığı ve dosya adı da İngilizce; kullanıcının dil tercihi bu tarafta (ör. 'Reading the day…' ve 'All in the selection') tutarlı mı, kullanıcı onayıyla gözden geçirilebilir.
- Vardiya amiri için sayfada en önemli bilgi (kritik notlar ve en çok kayıp) en üstteki yönetim özetinde; bu özetin ilk ekranda kalıp kalmadığı gerçek ekran boyutunda bir kez kontrol edilmeli (arayüz kararı, kullanıcı onayı).
- makineler.tsx 1324 satır ve Hall/Stop açıklama bileşenleri sayfanın içinde; bunları components/ altına taşımak ilişki okumayı kolaylaştırır ama büyük bir yeniden düzenleme olduğu için kullanıcı onayı gerekir.
- HallInfo metni 'Work Calendar page' diyor; bu sayfaya doğrudan bağlantı yok. /takvim ile eşleşip eşleşmediği doğrulanıp bağlantı eklenirse 30 saniyelik kullanımda sayfa geçişi kolaylaşır (rota bağlantısı, kullanıcı onayı).
