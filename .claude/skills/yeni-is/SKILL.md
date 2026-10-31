---
name: yeni-is
description: Yeni bir oturumda yeni bir işe en az token ile başlamak için. Oturumun ilk talimatında, işe başlamadan önce kullan.
---

# Yeni iş — az bağlamla başla

1. `docs/wiki/README.md` tablosundan işle ilgili **tek** sayfayı seç ve oku. `07-calisma-sozlesmesi.md`'den yalnız
   *Yeni talimat geldiğinde* listesini uygula (sayfanın tamamını özetleme).
2. `todolist.md`'yi bütün okuma: `grep -n "<anahtar kelime>" todolist.md` ile ilgili maddeyi bul, o bölümü oku.
3. Koda gir: önce `grep -rn "<fonksiyon/alan>" src convex --include=*.ts* | head -30`, sonra yalnız ilgili
   aralığı `Read` (offset/limit ≤150). `CLAUDE.md`'deki büyük dosyaları asla bütün okuma.
4. Birçok dosyaya yayılan "nerede kullanılıyor" sorusu → `Explore` ajanı (medium), sonucu 5 satırda iste.
5. Kullanıcıya planı **3–5 madde** ile yaz ve başla (`07`: onay beklemeden ilerle; geri alınamaz işte sor).
6. Kodu Claude yazar: en küçük modelden başla, zorlanınca büyüt, bitince geri in (`CLAUDE.md` → *Model*).
7. Dal aç: `git checkout -b claude/<konu>`. Test: önce yalnız ilgili test dosyası
   (`npx vitest run <dosya> 2>&1 | tail -25`), en sonda bir kez `npm run verify 2>&1 | tail -40`.
