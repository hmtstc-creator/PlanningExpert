# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-1440 · src/routes/oee/settings.tsx · degisiklik-yok: Toplantıda src/routes/oee/settings.tsx'in ilk 220 satırı incelendi: kurulum adımları (veri yükleme, öneri, kontrol, kaydetme), masraf yeri ve vardiya listeleri ile departman ayarları tek bir draft/kaydet akışından besleniyor. Ciddi bir veri ya da sayfa ilişki hatası bulunmadı, bu yüzden yazılacak görev yok. Üç öneri not edildi: 'Sugge
- 20261102-1340 · src/routes/oee/report.tsx · degisiklik-yok: Toplantıda src/routes/oee/report.tsx'in ilk 220 satırı incelendi: OEE Daily Report'un veri akışı (oee.days, lossDays, stopDays, orders, shifts) tek yoldan besleniyor, vardiya ve makine filtreleri Loss Bridge ile ortak, kayıp hesabı oeeDailyReport'tan geliyor. Ciddi bir veri ya da ilişki hatası bulunmadı, bu yüzden yazılacak görev yok. V
- 20261102-1240 · src/routes/oee/mttr.tsx · degisiklik-yok: Toplantıda src/routes/oee/mttr.tsx'in ilk 220 satırı incelendi. MTTR ve MTBF hesabı tek veri yolundan (oee.days, oee.stopDays, oee.downtimeDays) besleniyor, dönemler (ay, hafta, gün) aynı yardımcılarla üretiliyor ve kısa duruş eşiği OEE Settings'ten gelip sayfa tercihiyle geçersiz kılınabiliyor. Ciddi bir veri ya da ilişki hatası bulunmad

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- 'Suggest from data' düğmesi, kullanıcının önceden yaptığı ad değişikliklerini ve kod listelerini onay sormadan üzerine yazıyor; kaydedilmemiş bir draft varken ya da listeler dolu iken önce onay penceresi gösterilmesi kullanıcı kararıyla değerlendirilmeli.
- days, shifts ve downRaw için '?? []' yükleme sırasında her render'da yeni bir dizi üretiyor; found, downtimes ve undefinedCodes gibi useMemo'lar bu yüzden her render'da yeniden hesaplanır. Sabit bir boş dizi kullanılarak düzeltilebilir, ancak bu değişiklik korunan alana dokunmuyor ve kullanıcı ona
- 'Check and rename' adımındaki sorun metni (ör. 'Everything is defined.' ya da uyarı listesi) vardiya amiri için hangi alanın düzeltileceğini söylemiyor; hangi kartta eksik olduğunu gösteren bağlantı ya da kısa eylem cümlesi kullanıcı onayıyla eklenmeli.
- Departments kartının info metni çok uzun ve masraf yeri / makine seçimi açıklamasını tek satırda vermiyor; vardiya amiri için ilk cümlede tek anlamlı özet eklenmesi kullanıcı onayıyla düşünülmeli.
- rc1Values ve texts listeleri her render'da hesaplanıyor; yalnız düzenleme sırasında kullanılıyorsa useMemo ile sarılması performans için küçük bir iyileştirme olur, ama davranış değişmez.
- Boş durum ve bilgi notundaki "Materials of the downtimes are not ready ... open any OEE page once" cümlesi vardiya amiri için teknik; kısa ve eylem odaklı bir metin (ne yapılacağı ve kime başvurulacağı) kullanıcı onayıyla düşünülmeli.
- Satırların altındaki "Click a part (reference): its days, shifts and loss details open on the right." ipucu, "part" kelimesinin parça mı referans mı olduğunu belirsiz bırakıyor; "Click a reference (material)" gibi tek anlamlı bir ifade kullanıcı kararıyla değerlendirilmeli.
- Tablo başlığındaki "Loss 1 · parts" sütun etiketi, malzeme adlarını (parts) gösterdiği için vardiya amiri tarafından kolayca yanlış okunabilir; "Loss 1 · materials" gibi bir etiket düşünülmeli.
- Sağ paneli açmak için tıklama gerektiği ilk bakışta görünmüyor; ilk satıra satır başına kısa bir ipucu veya ilk malzemenin varsayılan açık gelmesi kullanıcı kararıyla değerlendirilmeli.
- Shift filtresi 8 güne kadar çalışıyor ama uyarı, "all shifts are shown" ifadesiyle geliyor; neden sınırlandığını ve daha uzun dönemde ne yapılacağını tek cümlede anlatan bir not, kullanıcı onayıyla eklenmeli.
