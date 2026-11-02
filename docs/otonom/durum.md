# Otonom döngü — durum özeti

> Üreten: `scripts/otonom/gunluk.mjs` (her yayında). Toplantı yalnız bunu okur.

## Son kararlar
- 20261102-0640 · src/routes/oee/data.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/data.tsx'in ilk 220 satırı incelendi. Sayfa, yüklenen Shiftly, Order ve Downtimes sayfalarını dosya sırasında gösteriyor; gün, hafta ve ay satırları vardiyalardan hesaplanıyor ve dönem ile kapsam filtresi tek yoldan geçiyor. Sayfanın kalan kısmındaki tekrar bulma (DuplicateCheck) akışı ve tablo ayrıntı
- 20261102-0540 · src/routes/oee/bridge.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/bridge.tsx'in ilk 220 satırı incelendi. Dönem, vardiya ve makine filtreleri tek hesap yolunda birleşiyor; parça ve neden kırılımları ile Die Follow-up'a takip konusu açma akışı tutarlı görünüyor. Sayfanın 826 satırlık geri kalanı bu toplantıda okunmadı. Ciddi bir hata bulunmadığı için yazılacak görev
- 20261102-0440 · src/routes/oee/asakai-weekly.tsx · degisiklik-yok: Toplantıda odak sayfa src/routes/oee/asakai-weekly.tsx'in ilk 220 satırı incelendi. Sayfa, bugünü hesaba katmayıp en son dünü gösteriyor ve bu kuralı üst bilgi metninde açıklıyor. Masraf yerinin tüm iş yerleri satır olarak gösteriliyor, hafta ve ay hesapları aynı kaynaktan geliyor. Planlama mantığında, veri akışında veya katman i

## Bekleyen öneriler (korunan alan / büyük iş — Claude ya da kullanıcı)
- Data sayfasındaki 'Check duplicates' akışı (önce tarama, sonra onaylı silme) vardiya amiri için tehlikeli olabilir; onay metni ve silinecek kayıt sayısının açıkça gösterilmesi kullanıcı onayıyla gözden geçirilmeli.
- Shiftly KPI, Order Based KPI ve Downtimes sekmelerinin açıklama satırları (note) İngilizce ve kısa; Türkçe karşılık ya da ilk satırda 'hangi dönem' bilgisi vardiya amirinin 30 saniyede anlaması için yardımcı olur. Arayüz metni değiştiği için kullanıcı onayı gerekir.
- Satır sayısı 3000'i aşınca yalnız ilk 3000 satır gösteriliyor; kullanıcıya dışa aktarma (CSV) ya da filtre yönlendirmesi eklenmesi büyük bir fikir, kullanıcı kararı gerekir.
- Sayfa ilişki haritasında /oee/data'dan /oee/dies ve /oee/report'a giden bağlantılar eksik görünüyor; relatedPages tanımı ile haritanın tutarlılığı salt okuma ile doğrulanmalı.
- Odak dosyanın kalan ~600 satırı (DuplicateCheck ve sonrası) bir sonraki toplantıda okunmalı.
- Bridge sayfasının üst bilgi metni uzun; vardiya amiri için ilk satıra 'Red = en büyük kayıp' gibi tek satırlık bir özet konabilir. Arayüz metni değiştiği için kullanıcı onayı gerekir.
- Bridge sayfasından /oee/losses ve /oee/mttr'a giden bağlantılar var ama /oee/asakai-detail'a yok; kayıp sayfasından Asakai günlük ekranına relatedPages ile geçiş eklenirse vardiya amiri iki görünüm arasında tek tıkla geçer. Arayüz kararı kullanıcıya sorulmalı.
- Parça ve neden satırlarında OEE/dakika birimi yalnız başlıkta; hücrelere birim eklenmesi okunabilirliği artırır. Görsel değişiklik olduğu için kullanıcı onayı gerekir.
- Sayfanın kalan 606 satırı (Level 3 tablosu ve grafikler) bir sonraki toplantıda odaklanılmalı; gerçek ekran boyutunda ilk yüklemede 'Loading' yerine dolu tablo görünümü tarayıcıyla doğrulanmalı.
- Bridge ile Die Follow-up arasında takip konusu açma akışı var; açılan konunun Die Follow-up'ta görünüp görünmediği ve geri dönüş bağlantısının olup olmadığı salt okuma ile kontrol edilmeli.
