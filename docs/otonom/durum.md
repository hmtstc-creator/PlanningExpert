# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-1540 · src/routes/oee/topics.tsx · degisiklik-yok: Toplantıda src/routes/oee/topics.tsx'in ilk 220 satırı incelendi: açık konular sayfası, ajanın bulduğu kronik ve kritik kayıpları masraf yeri bazında gruplar ve kapatma/yeniden açma işlemlerini sunuyor. Veri tek kaynak olan oeeTopics.list ve oeeTopics.runs sorgularından geliyor, kurallar sayfa üstündeki bilgi metninde açıklanıyor. Ciddi
- 20261102-1440 · src/routes/oee/settings.tsx · degisiklik-yok: Toplantıda src/routes/oee/settings.tsx'in ilk 220 satırı incelendi: kurulum adımları (veri yükleme, öneri, kontrol, kaydetme), masraf yeri ve vardiya listeleri ile departman ayarları tek bir draft/kaydet akışından besleniyor. Ciddi bir veri ya da sayfa ilişki hatası bulunmadı, bu yüzden yazılacak görev yok. Üç öneri not edildi: 'Sugge
- 20261102-1340 · src/routes/oee/report.tsx · degisiklik-yok: Toplantıda src/routes/oee/report.tsx'in ilk 220 satırı incelendi: OEE Daily Report'un veri akışı (oee.days, lossDays, stopDays, orders, shifts) tek yoldan besleniyor, vardiya ve makine filtreleri Loss Bridge ile ortak, kayıp hesabı oeeDailyReport'tan geliyor. Ciddi bir veri ya da ilişki hatası bulunmadı, bu yüzden yazılacak görev yok. V

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Sayfanın üstündeki bilgi metni üç uzun paragraf; vardiya amiri için ilk cümlede tek satırlık özet (ör. 'Chronic losses to act on, per cost center') eklenmesi kullanıcı onayıyla düşünülmeli.
- Kapatma notu alanı boş iken 'Close' düğmesi pasif; neden pasif olduğunu gösteren kısa bir ipucu (ör. 'Write what was done to close') eklenmesi vardiya amiri için okunabilirliği artırır, ama arayüz metni olduğu için kullanıcı onayı gerekir.
- 'Analyse the last day' düğmesi yalnız oee.data düzenleme yetkisi olanlara görünüyor; yetkisiz kullanıcı neden düğmeyi göremediğini anlayamaz. Bu bir yetki/arayüz kararı, kullanıcı onayı gerekir.
- 'Last analysis' satırındaki 'added / seen again' ifadesi ve 'AI not set up: the rules decide.' cümlesi teknik; vardiya amirinin anlayacağı kısa bir Türkçe/İngilizce etiket düşünülebilir.
- Kronik konu kartındaki 'AI' / 'rules' etiketi ne anlama geldiğini açıklamıyor; kısa bir açıklama veya ipucu kullanıcı kararıyla eklenmeli.
- Yükleme sırasında 'Loading…' ve boş durumda 'No open topic.' gösteriliyor; 'No open topic' ifadesinin son analiz tarihiyle birlikte gösterilmesi, konunun gerçekten temiz mi yoksa analiz mi yapılmadı sorusunu yanıtlar. Bu değişiklik sayfa mantığını etkilediği için önce kullanıcıya sorulmalı.
- 'Suggest from data' düğmesi, kullanıcının önceden yaptığı ad değişikliklerini ve kod listelerini onay sormadan üzerine yazıyor; kaydedilmemiş bir draft varken ya da listeler dolu iken önce onay penceresi gösterilmesi kullanıcı kararıyla değerlendirilmeli.
- days, shifts ve downRaw için '?? []' yükleme sırasında her render'da yeni bir dizi üretiyor; found, downtimes ve undefinedCodes gibi useMemo'lar bu yüzden her render'da yeniden hesaplanır. Sabit bir boş dizi kullanılarak düzeltilebilir, ancak bu değişiklik korunan alana dokunmuyor ve kullanıcı ona
- 'Check and rename' adımındaki sorun metni (ör. 'Everything is defined.' ya da uyarı listesi) vardiya amiri için hangi alanın düzeltileceğini söylemiyor; hangi kartta eksik olduğunu gösteren bağlantı ya da kısa eylem cümlesi kullanıcı onayıyla eklenmeli.
- Departments kartının info metni çok uzun ve masraf yeri / makine seçimi açıklamasını tek satırda vermiyor; vardiya amiri için ilk cümlede tek anlamlı özet eklenmesi kullanıcı onayıyla düşünülmeli.
