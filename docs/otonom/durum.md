# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-1340 · src/routes/oee/report.tsx · degisiklik-yok: Toplantıda src/routes/oee/report.tsx'in ilk 220 satırı incelendi: OEE Daily Report'un veri akışı (oee.days, lossDays, stopDays, orders, shifts) tek yoldan besleniyor, vardiya ve makine filtreleri Loss Bridge ile ortak, kayıp hesabı oeeDailyReport'tan geliyor. Ciddi bir veri ya da ilişki hatası bulunmadı, bu yüzden yazılacak görev yok. V
- 20261102-1240 · src/routes/oee/mttr.tsx · degisiklik-yok: Toplantıda src/routes/oee/mttr.tsx'in ilk 220 satırı incelendi. MTTR ve MTBF hesabı tek veri yolundan (oee.days, oee.stopDays, oee.downtimeDays) besleniyor, dönemler (ay, hafta, gün) aynı yardımcılarla üretiliyor ve kısa duruş eşiği OEE Settings'ten gelip sayfa tercihiyle geçersiz kılınabiliyor. Ciddi bir veri ya da ilişki hatası bulunmad
- 20261102-1140 · src/routes/oee/losses.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/losses.tsx'in ilk 220 satırı incelendi. Kayıp seçimi, alt kayıp karşılaştırması, iş merkezi filtresi ve paretoların hepsi tek veri yolundan (oee.days, oee.lossDays, oee.stopDays) besleniyor; hafta ve gün dönemleri ile Speed ayrımı tutarlı. Ciddi bir veri ya da ilişki hatası bulunmadı. Sayfanın 220. s

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Boş durum ve bilgi notundaki "Materials of the downtimes are not ready ... open any OEE page once" cümlesi vardiya amiri için teknik; kısa ve eylem odaklı bir metin (ne yapılacağı ve kime başvurulacağı) kullanıcı onayıyla düşünülmeli.
- Satırların altındaki "Click a part (reference): its days, shifts and loss details open on the right." ipucu, "part" kelimesinin parça mı referans mı olduğunu belirsiz bırakıyor; "Click a reference (material)" gibi tek anlamlı bir ifade kullanıcı kararıyla değerlendirilmeli.
- Tablo başlığındaki "Loss 1 · parts" sütun etiketi, malzeme adlarını (parts) gösterdiği için vardiya amiri tarafından kolayca yanlış okunabilir; "Loss 1 · materials" gibi bir etiket düşünülmeli.
- Sağ paneli açmak için tıklama gerektiği ilk bakışta görünmüyor; ilk satıra satır başına kısa bir ipucu veya ilk malzemenin varsayılan açık gelmesi kullanıcı kararıyla değerlendirilmeli.
- Shift filtresi 8 güne kadar çalışıyor ama uyarı, "all shifts are shown" ifadesiyle geliyor; neden sınırlandığını ve daha uzun dönemde ne yapılacağını tek cümlede anlatan bir not, kullanıcı onayıyla eklenmeli.
- days değişkeni (useQuery(...) ?? []) yükleme sırasında her render'da yeni dizi üretiyor; grids, periods ve weekByMachine gibi useMemo'lar bu yüzden her render'da yeniden hesaplanabilir. Düzeltme için days'i useMemo ile sabitlemek mantık değiştirmez ama mttr.tsx'in bu bölümü kullanıcı onayıyla ele 
- Boş durum notundaki 'open this page with OEE data rights once' ifadesi vardiya amiri için belirsiz; yetki gerektiğini ve kime başvuracağını kısa bir cümleyle yazmak kullanıcı kararıyla değerlendirilmeli.
- weekByMachine useMemo bağımlılıklarında sel.monday var ama hafta dönemi sel.sunday'i de kullanıyor; eksik bağımlılık eşitlenmeli (eslint-disable ile gizlenmiş).
- Info metni üç uzun paragraf; vardiya amiri için ilk satıra tek cümlelik özet (ör. 'MTTR = average stop length, MTBF = average run time between stops') eklenmesi kullanıcı onayıyla düşünülmeli.
- 'Min. duration' alanı varsayılan değeri (OEE Settings kısa duruş eşiği) sahada gösterilmiyor; title ile görünür ipucu verilmesi kullanıcı kararıyla değerlendirilmeli.
