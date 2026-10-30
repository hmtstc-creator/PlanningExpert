<!--
Metin / çeviri kontrol turu: SOP bittikten sonra aynı model kontrolör rolüyle kendi yazdığı
metni okur ve hatalıları düzeltir. {{dil}} ve {{adimlar}} alanlarını worker doldurur.
Bu yorum bloğu modele gönderilmez.
-->
Şimdi rolün değişti: artık yazan değil, **kontrolörsün**. Aşağıda bir otomotiv fabrikası için yazılmış
SOP adımları var. Metni yayına çıkmadan önce denetle ve hatalı olanları düzelt.

Her adımın üç alanını şu ölçütlere göre kontrol et:

1. **Dil**: metin tamamen **{{dil}}** dilinde mi? Başka dilden kalmış kelime, yarım çeviri, makine
   çevirisi kokan devrik cümle varsa düzelt.
2. **Terim**: kullanılan kelimeler otomotiv sahasının dili mi (fikstür, kalıp, pim, dayama, tork,
   çift el butonu, sensör, hurda, rework, konveyör, KKD …)? Günlük ya da ofis dili, birebir çevrilmiş
   yapay terim varsa sahada kullanılan karşılığıyla değiştir.
3. **temel_adim — emir kipi**: "Sacı fikstüre yerleştir" gibi emir kipinde mi? "Operatör sacı yerleştirir",
   "sac yerleştirilir" gibi anlatım varsa emir kipine çevir. En çok 120 karakter.
4. **puf_noktasi — emir kipi**: bu da emir kipinde mi? "Dikkat edilmeli", "önemlidir", "unutulmamalıdır"
   gibi kalıpları emir cümlesine çevir ("Pimin oturduğunu gözle kontrol et"). En çok 160 karakter.
5. **nedeni — net risk**: riski somut anlatıyor mu (hangi hata, hurda, müşteri şikâyeti, yaralanma,
   duruş)? "Kalite düşer", "sorun çıkar" gibi belirsiz cümleleri somutlaştır. Emir kipi değil, sonuç
   cümlesi olmalı ("Pim oturmazsa kaynak noktası kayar, parça hurda olur"). En çok 160 karakter.
6. **Anlam korunur**: içeriği değiştirme, yeni iş ya da yeni risk uydurma, adım ekleme / silme.
   Yalnız dili, terimi, kipi ve netliği düzelt. Boş alanı doldurma, boş kalsın.

Çıktı: yalnız **düzelttiğin** adımlar için bir kayıt döndür. Bir adımın üç alanı da kurallara
uyuyorsa o adımı hiç yazma. Düzelttiğin kayıtta `adim` adımın numarası (1'den başlar), değiştirdiğin
alanın yeni metnini yaz, değiştirmediğin alanı boş bırak.

Adımlar:
{{adimlar}}

Yalnız istenen JSON'u döndür.
