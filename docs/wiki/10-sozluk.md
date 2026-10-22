# 10 · Sözlük

> Son güncelleme: 2026-10-22 · Kaynak: kod ve Planning Logic

| Terim | Anlamı |
|---|---|
| **Lot** | Bir malzemenin bir kovadaki üretim adedi (rulo / Min. lot katına yuvarlanmış). Kimliği `malzeme|kova etiketi`. Bölünürse etiket `W38 (1/2)`. |
| **Kova (bucket)** | ZPP haftası ya da *Backlog*; lotun geldiği talep dilimi. |
| **Faz** | **backlog** (bakiye) → **urgent** (acil: başlangıç günü bugün/geçmiş) → **fill** (dolgu). Sıralama bu sırayla. |
| **Stok bitiş günü (stock-out day)** | Tahmini stoğun + önceki lotların eksiye düştüğü ilk gün. |
| **Emniyet stoğu (safety stock days)** | Lot, stok bitişinden bu kadar iş günü önce başlayabilir. |
| **Teslim noktası / kontrol noktası (checkpoint)** | Lotun karşıladığı her ihtiyaç günü ve o güne kadar gereken birikimli pay; teslim saati 08:00. |
| **Needed qty / On time / Late share** | İlk kaçırılan teslim noktasına kadar gereken adet / teslimde hazır pay / kalan pay (ortalama + son parça gecikmesi). |
| **Geç (late)** | Gereken pay teslim anında hazır değil. Plan geç işi **onarır** (boost, senaryo, yerel arama). |
| **Boost** | Geç lotu kendi fazının başına almak. |
| **Order shift** | Yerel aramanın lotu kendi fazı içinde ±gün kaydırması (faz sırasını aşmaz). |
| **Lot bölme (lot split)** | Uzun lotu tam rulo sınırında 2–3 parçaya ayırıp araya geç lotu almak. |
| **Takılı kalıp kuralı (mounted die)** | Preste takılı kalıbın bekleyen dolgu lotu, acil işten önce setup'sız devam eder (acil iş yine zamanındaysa). |
| **Dondurulmuş ufuk (frozen)** | Onaylı plandaki işler yerinde kalır; motor etrafına planlar. **Kilit (lock)** = tek bir işin onayı. |
| **Override** | Planlamacı müdahalesi: *priority* (öne al), *pin* (prese/güne sabitle), *exclude* (hariç tut), *quantity* (lot adedi). |
| **Work center / pres** | Üretim yeri (kod adı `press`). **Hol (hall)**: setup ekibi / vinç kuralı grubu. |
| **Mesai tanımı** | Mesai yalnızca bir tanımla (ad, başlangıç, süre) açılır; tarihli ya da tekrarlayan. |
| **Rulo (coil)** | Sac rulosu; `shotsPerCoil × göz` kadar parça verir. Bağlı rulo yarıda kesilmez. |
| **Eş ürün (co-product)** | Aynı vuruştan çıkan çift; sac yalnızca asıl ürünün gramajıyla sayılır. |
| **MB52 / MB51 / ZPP / ZPP_DAILY** | SAP dosyaları: stok / mal hareketi (üretim = giriş deposuna 101 − 102) / haftalık satış planı / günlük satış planı. |
| **Finished goods / Raw material depoları** | Storage Locations matrisinde tikli depolar; mamul stoğu / sac stoğu buradan sayılır. |
| **Lead time (tedarik süresi)** | Sac için sipariş → varış, **takvim günü**. *Order by* = teslim haftası Pazartesi − süre. |
| **Fallback mode** | WebSocket çalışmayınca HTTPS'e düşen istemci modu ([06](06-baglanti-ve-istemci.md)). |
| **Autodeploy** | Sunucuda 5 dakikada bir `deploy.sh`; `main`'deki yeni commit'i yayınlar. |
| **Planning Logic** | Sitedeki kural sayfası; mantık değişen her PR'da güncellenir (CI denetler). |
