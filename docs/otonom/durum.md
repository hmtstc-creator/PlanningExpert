# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-1240 · src/routes/oee/mttr.tsx · degisiklik-yok: Toplantıda src/routes/oee/mttr.tsx'in ilk 220 satırı incelendi. MTTR ve MTBF hesabı tek veri yolundan (oee.days, oee.stopDays, oee.downtimeDays) besleniyor, dönemler (ay, hafta, gün) aynı yardımcılarla üretiliyor ve kısa duruş eşiği OEE Settings'ten gelip sayfa tercihiyle geçersiz kılınabiliyor. Ciddi bir veri ya da ilişki hatası bulunmad
- 20261102-1140 · src/routes/oee/losses.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/losses.tsx'in ilk 220 satırı incelendi. Kayıp seçimi, alt kayıp karşılaştırması, iş merkezi filtresi ve paretoların hepsi tek veri yolundan (oee.days, oee.lossDays, oee.stopDays) besleniyor; hafta ve gün dönemleri ile Speed ayrımı tutarlı. Ciddi bir veri ya da ilişki hatası bulunmadı. Sayfanın 220. s
- 20261102-1040 · src/routes/oee/insights.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/insights.tsx'in ilk 220 satırı incelendi. Masraf yeri ve iş yeri seçimi, tarih aralığı ön ayarları ve geçmiş rapor listesi tek veri yolundan (oee.days, oeeInsights.list) besleniyor; ciddi bir veri ya da ilişki hatası bulunmadı. Rapor üretme yetkisi (canRun) düğme ve Regenerate davranışında tutarlı 

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- days değişkeni (useQuery(...) ?? []) yükleme sırasında her render'da yeni dizi üretiyor; grids, periods ve weekByMachine gibi useMemo'lar bu yüzden her render'da yeniden hesaplanabilir. Düzeltme için days'i useMemo ile sabitlemek mantık değiştirmez ama mttr.tsx'in bu bölümü kullanıcı onayıyla ele 
- Boş durum notundaki 'open this page with OEE data rights once' ifadesi vardiya amiri için belirsiz; yetki gerektiğini ve kime başvuracağını kısa bir cümleyle yazmak kullanıcı kararıyla değerlendirilmeli.
- weekByMachine useMemo bağımlılıklarında sel.monday var ama hafta dönemi sel.sunday'i de kullanıyor; eksik bağımlılık eşitlenmeli (eslint-disable ile gizlenmiş).
- Info metni üç uzun paragraf; vardiya amiri için ilk satıra tek cümlelik özet (ör. 'MTTR = average stop length, MTBF = average run time between stops') eklenmesi kullanıcı onayıyla düşünülmeli.
- 'Min. duration' alanı varsayılan değeri (OEE Settings kısa duruş eşiği) sahada gösterilmiyor; title ile görünür ipucu verilmesi kullanıcı kararıyla değerlendirilmeli.
- Sayfanın 220. satırdan sonrası (ayrı kova tablosu ve pres/parça/vardiya ayrıntısı) bir sonraki toplantıda ayrı odak olarak okunmalı.
- Sayfanın 220. satırdan sonrası (458 satır, PDF sayfası ve kalan bölümler) bir sonraki toplantıda ayrı odak olarak okunmalı.
- Info metnindeki 'Unassigned' ve 'Reason Code 1 or 2 “#”' cümlesi uzun ve tırnak işaretleri karışık; vardiya amiri için kısa bir ilk satır ve ayrıntının ayrı bilgi satırına alınması kullanıcı onayıyla değerlendirilmeli.
- Alt kayıp tablosundaki 'share' değerleri yalnız seçili haftaya göre hesaplanıyor; önceki hafta ile karşılaştırma yüzdesi (gapText) alt kayıp seçiliyken de doğru çalışıyor, ancak vardiya amiri için bu farkın ne anlama geldiği (pts) sayfada kısa bir cümleyle anlatılmalı; metin değişikliği kullanıcı 
- 'Work center all' etiketi PDF başlığında İngilizce kısaltma olarak geçiyor; sahada anlaşılır olması için 'All work centers' gibi tam metin kullanıcı kararıyla düşünülmeli.
