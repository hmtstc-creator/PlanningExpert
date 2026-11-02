# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-0140 · src/routes/makineler.tsx · degisiklik-yok: Toplantı odağı src/routes/makineler.tsx'in ilk 220 satırıydı. Work center ağacı, Hall (setup crane) ve Frekansiyel duruş açıklamaları planlama kurallarını sayfada anlatıyor; bu metinlerin planlogic.tsx ile çelişip çelişmediği bu incelemede doğrulanamadı. Planlama mantığında, veri akışında ya da katman ihlalinde kesin bir hata bulunmadı. 
- 20261102-0040 · src/routes/machine-followup/sop/index.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/machine-followup/sop/index.tsx incelendi. Form alanları, dosya seçimi ve yükleme akışı tek kaynaktan çalışıyor; planlama veya katman ihlali bulunmadı. Bulunan somut hata: video yüklenirken makine, hazırlayan ve tarih alanlarında yapılan değişiklikler, gönderim bittiğinde submit anındaki e
- 20261101-2340 · src/routes/machine-followup/sop/$id.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/machine-followup/sop/$id.tsx'in ilk 220 satırı incelendi. Sayfa veriyi sop.get üzerinden tek kaynaktan okuyor ve planlama ya da katman ihlali bulunmadı. Saniye giriş kutusunda boş değerin 0 olarak kabul edildiği ve '+ Second photo' akışında saniyenin video süresine sınırlanmadığı tespit edi

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- makineler.tsx 1324 satır ve Hall/Stop açıklama bileşenleri sayfanın içinde; bunları components/ altına taşımak ilişki okumayı kolaylaştırır ama büyük bir yeniden düzenleme olduğu için kullanıcı onayı gerekir.
- HallInfo metni 'Work Calendar page' diyor; bu sayfaya doğrudan bağlantı yok. /takvim ile eşleşip eşleşmediği doğrulanıp bağlantı eklenirse 30 saniyelik kullanımda sayfa geçişi kolaylaşır (rota bağlantısı, kullanıcı onayı).
- Hall ve frekansiyel duruş kuralları hem bu sayfada hem planlogic.tsx'te anlatılıyor; iki metnin aynı sayıyı ve kuralı verdiğinin kontrolü için planlogic.tsx korunan alan olduğundan yalnız okuma incelemesi gerekir.
- StopSelect içinde kullanılan NEW sabitinin dosyanın ilk 220 satırında tanımlı olmadığı görüldü; sabitin aşağıda tanımlandığı doğrulanmadan sorun sayılmamalı, ama tanım yerinin ilk 220 satırda görünür olması okumayı kolaylaştırır.
- 'Stop every N pieces' alanının planlayıcı tarafından kullanılmadığı metinde açıkça yazılı; vardiya kullanıcısının bu alanı doldurup etkisiz olduğunu fark etmemesi için alan yanında kısa bir uyarı metni eklenebilir (arayüz kararı, kullanıcı onayı).
- Saniye ve yükleme kalitesi için sunucu tarafı doğrulama (convex/sop.ts) bekleyen öneri olarak kalsın; convex ve korunan alan olduğu için bu toplantıda dokunulmadı.
- convex/sop.ts içindeki requestFrame ve saveDraft, second değerini 0 ile videoSeconds arasında doğruluyor mu kontrol edilmeli; sunucu tarafı doğrulama yoksa istemci düzeltmesi yetmez (salt okuma incelemesi, kullanıcı onayı gerekir).
- Saniye kutusunda sınır dışı ya da boş değer için form yanında kısa İngilizce uyarı metni eklenmesi, kullanıcının neden kare alınamadığını görmesini sağlar (arayüz kararı, önce kullanıcı onayı).
- Filtre durumu (from, to, press) URL arama parametresine taşınırsa sayfa yenilenince ya da bağlantıyla paylaşıldığında filtre korunur; yeni route parametresi olduğu için kullanıcı onayı gerekir.
- Durum özeti 'Still open' kutusunu status === 'open' ile sayıyor, ortalama çözüm süresi ise solvedAt'a bakıyor; iki tanımın machine-followup/breakdowns.tsx ve convex/schema.ts ile aynı olduğu doğrulanmalı (schema korunan alan, yalnız okuma).
