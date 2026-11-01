# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261101-2140 · src/routes/machine-followup/maintenance.tsx · degisiklik-yok: Toplantıda odak sayfa machine-followup/maintenance.tsx'in ilk 220 satırı incelendi. Bakım kaydı formu, planlanan ve gerçekleşen saat girişi ile yaklaşan/geçmiş ayrımı doğru veri akışına bağlı görünüyor; ilk 220 satırda planlama ya da katman ihlali bulunmadı. Bulunan iki sahada sorun var: eksik zorunlu alanda Add düğmes
- 20261101-2040 · src/routes/machine-followup/index.tsx · degisiklik-yok: Toplantıda odak sayfa machine-followup/index.tsx incelendi. Dört üst kutu (plana engel, duran tezgâh, açık arıza, 14 gün bakım) ve açık arıza listesi, veriyi doğru kaynaklardan okuyup doğru sayfalara bağlıyor; planlama ve vardiya açısından yanlış veri ya da kırık bağlantı bulunmadı. Bulgular düşük öncelikli: tipler inline ca
- 20261101-1940 · src/routes/machine-followup/breakdowns.tsx · degisiklik-yok: Toplantıda odak sayfa machine-followup/breakdowns.tsx incelendi (ilk 220 satır). Bildirim formu, tezgâh durduş bilgisi ve Alarms/Reports bağlantıları sayfa içinde tutarlı görünüyor. Fotoğraf yükleme hatasının kullanıcıya gösterilmediği ve sayfa ilişkilerinde tekrar eden yardımcıların (inputClass, hhmm, minuteOf) ortak y

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Eksik zorunlu alan (Work center veya Reason boş) ya da geçersiz saat girildiğinde submit() ve submitActual() sessizce döner; vardiya kullanıcısı neden kaydedilmediğini görmez. Form alanının yanında kısa İngilizce uyarı metni eklenmesi 30 saniyelik kullanımı kolaylaştırır (kullanıcı onayı: önce JSX
- Tarihi geçmiş ama status 'planned' olan bakımlar 'history' listesinde tamamlanmış kayıtlarla aynı yere düşüyor. Gecikmiş bakımın görünür bir 'overdue' işareti olmazsa amir bakımın yapılmadığını fark edemeyebilir; liste ayrımı için kullanıcı onayı gerekir.
- Gerçekleşen saat kutusu tek bir actualDate/actualStart/actualEnd durumu paylaşıyor; bir satırda açık kutu varken başka satır 'Record actual' a basıldığında değerler önceki satırdan kalabilir. Satır başına açılışta mevcut plan değerlerinin doldurulması daha güvenli olur (küçük arayüz kararı).
- planlogic.tsx (korunan alan, yalnız öneri): sayfadaki 'hours are taken out of that work center automatically' cümlesi, planlamacının bakım saatlerini gerçekten düşüldüğünü anlatmalı; bu kuralın Planning Logic sayfasında anlatıldığı doğrulanmalı.
- parseClock, clockLabel ve inputClass yardımcıları bu dosyada yeniden tanımlı; 'Rakam girildi ama aralık geçersiz' (ör. 25:99 ya da bitiş < başlangıç) kontrolü yok. Ortak saat yardımcısı ve doğrulama, şema ya da motor katmanına dokunmadan src/lib altında yapılabilir (birden çok dosya, kullanıcı ona
- Inline tip cast'leri (breakdowns, maintenance) convex/schema.ts ile çakışabilir; ortak tip kullanımı şema korunan alanı olduğu için kullanıcı onayı gerektirir.
- Açık arıza satırındaki 'running' ve 'down' metinleri text-amber-700 ve text-destructive gibi sabit renk sınıfları kullanıyor; tema token'ına taşınması görsel tutarlılığı artırır (küçük, ama genel stil kararı).
- Açık arıza satırı sayfadan ilgili arıza kaydına gitmiyor; vardiya amiri için breakdowns sayfasında ilgili kayda odaklanan bir bağlantı ya da filtre, 30 saniyelik bilgi ihtiyacını kısaltır (navigasyon kararı, kullanıcı onayı).
- 'Maintenance, next 14 days' kutusu bakım sayfasına gidiyor ama 14 günlük filtreyi uygulamıyor; bağlantıya tarih filtresi parametresi eklenirse amir tek tıkla ilgili kayda ulaşır (route arama parametresi, kullanıcı onayı).
- Bu sayfanın planlama mantığına etkisi yok; plan uyarıları usePlanAlarms üzerinden geliyor. Planning Logic sayfasında 'duran tezgâh, beklenen dönüş boşsa dışarıda kalır' kuralının anlatıldığı doğrulanmalı (planlogic.tsx korunan alan, yalnız öneri).
