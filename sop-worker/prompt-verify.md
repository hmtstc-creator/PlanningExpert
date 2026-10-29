<!--
Kare doğrulama turu: çıkarılan kareler adımlarla birlikte modele geri gösterilir.
{{adimlar}} alanını worker doldurur. Bu yorum bloğu modele gönderilmez.
-->
Aşağıda bir SOP'un adımları ve her adım için videodan alınmış kare(ler) var. Görseller adımların
sırasıyla, her görselden önce "Adım N, foto K, saniye S" yazısıyla verildi.

Her görsel için karar ver:
- **uygun**: görsel, adımda anlatılan işi net gösteriyor mu (el / parça / düğme görünüyor, bulanık değil, önü kapalı değil)?
- Uygun değilse **yeni_saniye**: adımın başlangıç–bitiş aralığında daha iyi bir an (bu aralığın dışına çıkma).
- **isaret**: bu görselde operatörün dikkat etmesi gereken yeri saran kutu [ymin, xmin, ymax, xmax] (0–1000).
  Görsel uygun değilse ve yeni saniye verdiysen isareti boş bırak.

Adımlar:
{{adimlar}}

Yalnız istenen JSON'u döndür.
