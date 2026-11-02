# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-0240 · src/routes/oee/agent.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/agent.tsx'in 220 satırı incelendi. Sayfa, OEE verisini ve açık konuları tek bir rapor fonksiyonuna (agentReport) veriyor; rapor günü, veri sonu tarihine göre kırpılıyor ve bu durum bir uyarı metniyle gösteriliyor. Kalıp ve makine konuları yalnızca ilgili izinler varsa okunuyor, sunucu tarafı izin kont
- 20261102-0140 · src/routes/makineler.tsx · degisiklik-yok: Toplantı odağı src/routes/makineler.tsx'in ilk 220 satırıydı. Work center ağacı, Hall (setup crane) ve Frekansiyel duruş açıklamaları planlama kurallarını sayfada anlatıyor; bu metinlerin planlogic.tsx ile çelişip çelişmediği bu incelemede doğrulanamadı. Planlama mantığında, veri akışında ya da katman ihlalinde kesin bir hata bulunmadı. 
- 20261102-0040 · src/routes/machine-followup/sop/index.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/machine-followup/sop/index.tsx incelendi. Form alanları, dosya seçimi ve yükleme akışı tek kaynaktan çalışıyor; planlama veya katman ihlali bulunmadı. Bulunan somut hata: video yüklenirken makine, hazırlayan ve tarih alanlarında yapılan değişiklikler, gönderim bittiğinde submit anındaki e

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Sayfanın bilgi metni (info) 'OEE Settings → Agent Report and Loss groups' bölümlerine bağlanıyor; oee/settings sayfasında bu iki bölümün gerçekten bulunduğu salt okuma ile doğrulanmalı, yoksa kullanıcı 30 saniyelik kullanımda yanlış yere gider.
- Rapor 'Critical / Warning / Watch / Good news' sınıflarını ve eşikleri oeeAgent.ts'ten üretiyor; bu eşik değerlerinin Planning Logic sayfasında (planlogic.tsx) anlatılıp anlatılmadığı kontrol edilmeli. Korunan alan olduğu için yalnız okuma incelemesi, kullanıcı onayıyla.
- Sayfadaki arayüz metinleri İngilizce, PDF başlığı ve dosya adı da İngilizce; kullanıcının dil tercihi bu tarafta (ör. 'Reading the day…' ve 'All in the selection') tutarlı mı, kullanıcı onayıyla gözden geçirilebilir.
- Vardiya amiri için sayfada en önemli bilgi (kritik notlar ve en çok kayıp) en üstteki yönetim özetinde; bu özetin ilk ekranda kalıp kalmadığı gerçek ekran boyutunda bir kez kontrol edilmeli (arayüz kararı, kullanıcı onayı).
- makineler.tsx 1324 satır ve Hall/Stop açıklama bileşenleri sayfanın içinde; bunları components/ altına taşımak ilişki okumayı kolaylaştırır ama büyük bir yeniden düzenleme olduğu için kullanıcı onayı gerekir.
- HallInfo metni 'Work Calendar page' diyor; bu sayfaya doğrudan bağlantı yok. /takvim ile eşleşip eşleşmediği doğrulanıp bağlantı eklenirse 30 saniyelik kullanımda sayfa geçişi kolaylaşır (rota bağlantısı, kullanıcı onayı).
- Hall ve frekansiyel duruş kuralları hem bu sayfada hem planlogic.tsx'te anlatılıyor; iki metnin aynı sayıyı ve kuralı verdiğinin kontrolü için planlogic.tsx korunan alan olduğundan yalnız okuma incelemesi gerekir.
- StopSelect içinde kullanılan NEW sabitinin dosyanın ilk 220 satırında tanımlı olmadığı görüldü; sabitin aşağıda tanımlandığı doğrulanmadan sorun sayılmamalı, ama tanım yerinin ilk 220 satırda görünür olması okumayı kolaylaştırır.
- 'Stop every N pieces' alanının planlayıcı tarafından kullanılmadığı metinde açıkça yazılı; vardiya kullanıcısının bu alanı doldurup etkisiz olduğunu fark etmemesi için alan yanında kısa bir uyarı metni eklenebilir (arayüz kararı, kullanıcı onayı).
- Saniye ve yükleme kalitesi için sunucu tarafı doğrulama (convex/sop.ts) bekleyen öneri olarak kalsın; convex ve korunan alan olduğu için bu toplantıda dokunulmadı.
