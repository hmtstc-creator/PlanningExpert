# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-2240 · src/routes/machine-followup/reports.tsx · degisiklik-yok: Toplantıda odak sayfa machine-followup/reports.tsx incelendi. Tarih ve tezgâh filtreleri, dört özet kutusu ve Pareto/matris grafikleri veriyi tek kaynaktan (machineProblems.list, presses.list) okuyor; planlama ya da katman ihlali bulunmadı. Tespit edilen somut eksik: filtre sonucu boş olduğunda sayfa sıfır değerler ve boş 
- 20261101-2140 · src/routes/machine-followup/maintenance.tsx · degisiklik-yok: Toplantıda odak sayfa machine-followup/maintenance.tsx'in ilk 220 satırı incelendi. Bakım kaydı formu, planlanan ve gerçekleşen saat girişi ile yaklaşan/geçmiş ayrımı doğru veri akışına bağlı görünüyor; ilk 220 satırda planlama ya da katman ihlali bulunmadı. Bulunan iki sahada sorun var: eksik zorunlu alanda Add düğmes
- 20261101-2040 · src/routes/machine-followup/index.tsx · degisiklik-yok: Toplantıda odak sayfa machine-followup/index.tsx incelendi. Dört üst kutu (plana engel, duran tezgâh, açık arıza, 14 gün bakım) ve açık arıza listesi, veriyi doğru kaynaklardan okuyup doğru sayfalara bağlıyor; planlama ve vardiya açısından yanlış veri ya da kırık bağlantı bulunmadı. Bulgular düşük öncelikli: tipler inline ca

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Filtre durumu (from, to, press) URL arama parametresine taşınırsa sayfa yenilenince ya da bağlantıyla paylaşıldığında filtre korunur; yeni route parametresi olduğu için kullanıcı onayı gerekir.
- Durum özeti 'Still open' kutusunu status === 'open' ile sayıyor, ortalama çözüm süresi ise solvedAt'a bakıyor; iki tanımın machine-followup/breakdowns.tsx ve convex/schema.ts ile aynı olduğu doğrulanmalı (schema korunan alan, yalnız okuma).
- Pareto'da 'Production lost' grupları downtimeMinutes boş kayıtlarda undefined değer üretebilir; groupBy'ın toplamı nasıl aldığı kontrol edilmeli, gerekirse ortak yardımcıda düzeltilmeli (src/lib/problemReport, birden çok sayfayı etkiler, kullanıcı onayı).
- Tarih aralığı (From/To) için 'From > To' kontrolü yok; ters aralıkta sonuç sessizce boş çıkar. Ortak tarih yardımcısı için birden çok sayfaya dokunulacağından kullanıcı onayı gerekir.
- 'inputClass', 'Breakdown' tipi ve presses cast'i breakdowns.tsx ve maintenance.tsx ile tekrar ediyor; ortak tip ve sınıf sabiti convex/schema.ts ile hizalanarak tek yerden alınabilir (kullanıcı onayı).
- Eksik zorunlu alan (Work center veya Reason boş) ya da geçersiz saat girildiğinde submit() ve submitActual() sessizce döner; vardiya kullanıcısı neden kaydedilmediğini görmez. Form alanının yanında kısa İngilizce uyarı metni eklenmesi 30 saniyelik kullanımı kolaylaştırır (kullanıcı onayı: önce JSX
- Tarihi geçmiş ama status 'planned' olan bakımlar 'history' listesinde tamamlanmış kayıtlarla aynı yere düşüyor. Gecikmiş bakımın görünür bir 'overdue' işareti olmazsa amir bakımın yapılmadığını fark edemeyebilir; liste ayrımı için kullanıcı onayı gerekir.
- Gerçekleşen saat kutusu tek bir actualDate/actualStart/actualEnd durumu paylaşıyor; bir satırda açık kutu varken başka satır 'Record actual' a basıldığında değerler önceki satırdan kalabilir. Satır başına açılışta mevcut plan değerlerinin doldurulması daha güvenli olur (küçük arayüz kararı).
- planlogic.tsx (korunan alan, yalnız öneri): sayfadaki 'hours are taken out of that work center automatically' cümlesi, planlamacının bakım saatlerini gerçekten düşüldüğünü anlatmalı; bu kuralın Planning Logic sayfasında anlatıldığı doğrulanmalı.
- parseClock, clockLabel ve inputClass yardımcıları bu dosyada yeniden tanımlı; 'Rakam girildi ama aralık geçersiz' (ör. 25:99 ya da bitiş < başlangıç) kontrolü yok. Ortak saat yardımcısı ve doğrulama, şema ya da motor katmanına dokunmadan src/lib altında yapılabilir (birden çok dosya, kullanıcı ona
