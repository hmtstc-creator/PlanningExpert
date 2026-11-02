# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-0940 · src/routes/oee/index.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/index.tsx'in ilk 220 satırı incelendi. Trend sayfası OEE hesabını tek veri yolundan (days, shifts, periods) alıyor ve sütundan Loss Bridge'e geçiş yetki kontrolüyle çalışıyor; ciddi bir veri ya da ilişki hatası bulunmadı. Boş durum mesajındaki 'Upload data' ifadesi tıklanabilir değil, vardiya amiri iç
- 20261102-0840 · src/routes/oee/guide.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/guide.tsx'in ilk 220 satırı incelendi. Sayfa kullanım yöntemini beş adımda anlatıyor ve 'What is stored now' tablosu coverage ve settings verisini tek kaynaktan okuyor. Yükleme adresi (/oee/data) ve ayarlar (/oee/settings) bağlantıları doğru, kısa durak ve MES sabitleri koddan okunuyor. Adım 2'de 'Wor
- 20261102-0640 · src/routes/oee/data.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/data.tsx'in ilk 220 satırı incelendi. Sayfa, yüklenen Shiftly, Order ve Downtimes sayfalarını dosya sırasında gösteriyor; gün, hafta ve ay satırları vardiyalardan hesaplanıyor ve dönem ile kapsam filtresi tek yoldan geçiyor. Sayfanın kalan kısmındaki tekrar bulma (DuplicateCheck) akışı ve tablo ayrıntı

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- 'Shifts worked' açıklaması (shiftNote) yaklaşık 300 karakter ve üç farklı hesap kuralını bir arada anlatıyor; vardiya amiri için kısa bir ilk satır ('Shifts worked = loading ÷ net shift') ve ayrıntının ayrı bir bilgi satırına alınması kullanıcı kararıyla düşünülmeli.
- Sayfa 220. satırdan sonra okunmadı; bir sonraki toplantıda kalan kısmı (Section sonrası ve varsa ek bileşenler) ayrı bir odak olarak incelenmeli.
- Düzen: son Section'dan sonra gereksiz boş satır var ve sayfa sonundaki 'Losses Trend' bağlantısı yalnız küçük metin olarak duruyor; vardiya amiri için üst kısımda da analiz sayfalarına bağlantı konup konmayacağı kullanıcı onayıyla belirlenmeli.
- Guide sayfasında Adım 2'deki 'Work center Save.' cümlesi anlamsız görünüyor; muhtemelen 'Press Save.' olmalı. Niyet doğrulanıp kullanıcı onayıyla düzeltilmeli.
- Guide sayfası uzun ve yalnızca okuma amaçlı; vardiya amiri için en üste 'Haftalık yükleme: Pazartesi başlayan dosya' gibi tek satırlık bir özet kutusu eklenmesi kullanıcı kararıyla düşünülmeli.
- 'What is stored now' tablosundaki 'nothing yet' durumu için ilgili yükleme sayfasına (/oee/data) doğrudan bağlantı eklenebilir; arayüz kararı kullanıcıya sorulmalı.
- Guide sayfasının 220. satırdan sonrası (Status ve Step bileşenleri dışında kalan kısım) bu toplantıda yok; bir sonraki toplantıda başka odak sayfaya geçilmeli.
- relatedPages('/oee/guide') bağlantıları ile haritadaki bağlantılar (/oee/data, /oee/settings) tutarlı; /oee/losses ve /oee/mttr gibi analiz sayfalarına 'sonraki adım' bağlantısı eklenip eklenmeyeceği kullanıcıya sorulmalı.
- Data sayfasındaki 'Check duplicates' akışı (önce tarama, sonra onaylı silme) vardiya amiri için tehlikeli olabilir; onay metni ve silinecek kayıt sayısının açıkça gösterilmesi kullanıcı onayıyla gözden geçirilmeli.
- Shiftly KPI, Order Based KPI ve Downtimes sekmelerinin açıklama satırları (note) İngilizce ve kısa; Türkçe karşılık ya da ilk satırda 'hangi dönem' bilgisi vardiya amirinin 30 saniyede anlaması için yardımcı olur. Arayüz metni değiştiği için kullanıcı onayı gerekir.
