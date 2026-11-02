# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-1140 · src/routes/oee/losses.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/losses.tsx'in ilk 220 satırı incelendi. Kayıp seçimi, alt kayıp karşılaştırması, iş merkezi filtresi ve paretoların hepsi tek veri yolundan (oee.days, oee.lossDays, oee.stopDays) besleniyor; hafta ve gün dönemleri ile Speed ayrımı tutarlı. Ciddi bir veri ya da ilişki hatası bulunmadı. Sayfanın 220. s
- 20261102-1040 · src/routes/oee/insights.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/insights.tsx'in ilk 220 satırı incelendi. Masraf yeri ve iş yeri seçimi, tarih aralığı ön ayarları ve geçmiş rapor listesi tek veri yolundan (oee.days, oeeInsights.list) besleniyor; ciddi bir veri ya da ilişki hatası bulunmadı. Rapor üretme yetkisi (canRun) düğme ve Regenerate davranışında tutarlı 
- 20261102-0940 · src/routes/oee/index.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/index.tsx'in ilk 220 satırı incelendi. Trend sayfası OEE hesabını tek veri yolundan (days, shifts, periods) alıyor ve sütundan Loss Bridge'e geçiş yetki kontrolüyle çalışıyor; ciddi bir veri ya da ilişki hatası bulunmadı. Boş durum mesajındaki 'Upload data' ifadesi tıklanabilir değil, vardiya amiri iç

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Sayfanın 220. satırdan sonrası (458 satır, PDF sayfası ve kalan bölümler) bir sonraki toplantıda ayrı odak olarak okunmalı.
- Info metnindeki 'Unassigned' ve 'Reason Code 1 or 2 “#”' cümlesi uzun ve tırnak işaretleri karışık; vardiya amiri için kısa bir ilk satır ve ayrıntının ayrı bilgi satırına alınması kullanıcı onayıyla değerlendirilmeli.
- Alt kayıp tablosundaki 'share' değerleri yalnız seçili haftaya göre hesaplanıyor; önceki hafta ile karşılaştırma yüzdesi (gapText) alt kayıp seçiliyken de doğru çalışıyor, ancak vardiya amiri için bu farkın ne anlama geldiği (pts) sayfada kısa bir cümleyle anlatılmalı; metin değişikliği kullanıcı 
- 'Work center all' etiketi PDF başlığında İngilizce kısaltma olarak geçiyor; sahada anlaşılır olması için 'All work centers' gibi tam metin kullanıcı kararıyla düşünülmeli.
- Kayıp seçimi ile alt kayıp seçimi aynı anda değişince (pickLoss) alt kayıp sıfırlanıyor; kullanıcı bir alt kaybı seçip sonra ana kaybı değiştirince seçimin kaybolduğunu fark etmeyebilir, bu davranış sayfada ya da satırda belirtilmeli.
- Sayfa açıklaması (info) üç uzun paragraf; vardiya amiri için ilk satıra tek cümlelik özet ('Pick a cost center and a period, then press Agent report') eklenmesi kullanıcı onayıyla düşünülmeli.
- Masraf yeri listesi boşken 'Agent report' düğmesi sebepsiz pasif kalıyor; title ile 'No cost center in this period' gibi bir neden gösterilmesi kullanıcı kararıyla değerlendirilmeli.
- Sayfanın 220. satırdan sonrası (ReportView ayrıntısı ve kalan bileşenler) bu toplantıda okunmadı; bir sonraki toplantıda devam edilmeli.
- Hata mesajı doğrudan e.message olarak gösteriliyor; sahada anlaşılır bir metin için kullanıcı onayıyla kısa bir çeviri ya da genel uyarı önerilir.
- 'Regenerate' yalnız done/failed/stale durumda görünüyor; kullanıcı bunu bulamayabilir. Görünürlük kararı kullanıcıya sorulmalı.
