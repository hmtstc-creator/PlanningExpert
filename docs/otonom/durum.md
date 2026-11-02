# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-1040 · src/routes/oee/insights.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/insights.tsx'in ilk 220 satırı incelendi. Masraf yeri ve iş yeri seçimi, tarih aralığı ön ayarları ve geçmiş rapor listesi tek veri yolundan (oee.days, oeeInsights.list) besleniyor; ciddi bir veri ya da ilişki hatası bulunmadı. Rapor üretme yetkisi (canRun) düğme ve Regenerate davranışında tutarlı 
- 20261102-0940 · src/routes/oee/index.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/index.tsx'in ilk 220 satırı incelendi. Trend sayfası OEE hesabını tek veri yolundan (days, shifts, periods) alıyor ve sütundan Loss Bridge'e geçiş yetki kontrolüyle çalışıyor; ciddi bir veri ya da ilişki hatası bulunmadı. Boş durum mesajındaki 'Upload data' ifadesi tıklanabilir değil, vardiya amiri iç
- 20261102-0840 · src/routes/oee/guide.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/guide.tsx'in ilk 220 satırı incelendi. Sayfa kullanım yöntemini beş adımda anlatıyor ve 'What is stored now' tablosu coverage ve settings verisini tek kaynaktan okuyor. Yükleme adresi (/oee/data) ve ayarlar (/oee/settings) bağlantıları doğru, kısa durak ve MES sabitleri koddan okunuyor. Adım 2'de 'Wor

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Sayfa açıklaması (info) üç uzun paragraf; vardiya amiri için ilk satıra tek cümlelik özet ('Pick a cost center and a period, then press Agent report') eklenmesi kullanıcı onayıyla düşünülmeli.
- Masraf yeri listesi boşken 'Agent report' düğmesi sebepsiz pasif kalıyor; title ile 'No cost center in this period' gibi bir neden gösterilmesi kullanıcı kararıyla değerlendirilmeli.
- Sayfanın 220. satırdan sonrası (ReportView ayrıntısı ve kalan bileşenler) bu toplantıda okunmadı; bir sonraki toplantıda devam edilmeli.
- Hata mesajı doğrudan e.message olarak gösteriliyor; sahada anlaşılır bir metin için kullanıcı onayıyla kısa bir çeviri ya da genel uyarı önerilir.
- 'Regenerate' yalnız done/failed/stale durumda görünüyor; kullanıcı bunu bulamayabilir. Görünürlük kararı kullanıcıya sorulmalı.
- Rapor geçmişi listesinde iş yeri 'all work centers' İngilizce metni vardiya amiri için kısaltılabilir; arayüz metni değişikliği kullanıcı onayı gerektirir.
- 'Shifts worked' açıklaması (shiftNote) yaklaşık 300 karakter ve üç farklı hesap kuralını bir arada anlatıyor; vardiya amiri için kısa bir ilk satır ('Shifts worked = loading ÷ net shift') ve ayrıntının ayrı bir bilgi satırına alınması kullanıcı kararıyla düşünülmeli.
- Sayfa 220. satırdan sonra okunmadı; bir sonraki toplantıda kalan kısmı (Section sonrası ve varsa ek bileşenler) ayrı bir odak olarak incelenmeli.
- Düzen: son Section'dan sonra gereksiz boş satır var ve sayfa sonundaki 'Losses Trend' bağlantısı yalnız küçük metin olarak duruyor; vardiya amiri için üst kısımda da analiz sayfalarına bağlantı konup konmayacağı kullanıcı onayıyla belirlenmeli.
- Guide sayfasında Adım 2'deki 'Work center Save.' cümlesi anlamsız görünüyor; muhtemelen 'Press Save.' olmalı. Niyet doğrulanıp kullanıcı onayıyla düzeltilmeli.
