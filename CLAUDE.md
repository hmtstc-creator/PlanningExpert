# PlanningExpert — çalışma kuralları

Bu dosya depoda çalışan her Claude oturumu (bulut ya da sunucu) için geçerlidir.

## Her talimattan önce: mimari etki kontrolü (zorunlu)

Yeni bir talimata **başlamadan önce** `docs/wiki/07-calisma-sozlesmesi.md` → *Yeni talimat geldiğinde* listesi
uygulanır: hangi katman, tek kaynak, motorun değişmezleri, canlı veri / şema, Planning Logic, wiki, etkilenen
yerler, geri alınabilirlik. Genel mimariye zarar veren bir değişiklik **yapılmaz**; nedeni ve alternatifi
kullanıcıya yazılır. Otomatik korumalar: `src/lib/architecture.test.ts` (katman yönü, saf hesap dosyaları,
bağımsız doğrulayıcı), `scripts/check-logic-docs.sh`, şema ve yetki testleri.

## Wiki programın kalıcı hafızasıdır (zorunlu)

Yeni sohbet açılmaz; bilgi `docs/wiki/` içindedir (dizin: `docs/wiki/README.md`). İşe başlarken ilgili sayfa okunur.
Mimariyi, bir akışı, bir kuralı ya da bir kararı değiştiren her PR ilgili wiki sayfasını (başındaki *Son güncelleme*
dahil) ve `docs/wiki/08-surum-gunlugu.md`'ye bir satırı **aynı PR'da** günceller. Yeni sayfa dizine eklenir
(`src/lib/wiki.test.ts` denetler). Wiki ile kod çelişirse kod doğrudur; çelişki aynı gün düzeltilir.

## Planning Logic her değişiklikte güncellenir (zorunlu)

`src/routes/planlogic.tsx` (Planning Logic sayfası) planlamacının programın mantığını
okuduğu **tek yerdir**; kodla çelişmemeli, eksik kalmamalı.

- Planlama mantığını değiştiren **her** değişiklikte aynı PR'da Planning Logic sayfası da
  güncellenir: motor (`planPipeline`, `scheduler`, `planning`), doğrulayıcı
  (`planValidator`), hammadde (`rawMrp`, `rawLeadTime`), vardiya / takvim ve OEE hesapları,
  geç iş tanımı, senaryo / yerel arama, lot bölme, varsayılan değerler.
- Anlatım sade ve doğru olmalı: ne hesaplanıyor, hangi girdi, hangi sınır, örnek sayı.
  Kodda olup sayfada olmayan bir kural eksiktir; sayfada olup kodda olmayan bir kural hatadır.
- Sayı, süre ve varsayılan değerler sayfada **koddan okunur** (ör. `SETTINGS_DEFAULTS`,
  `current.*`), elle yazılmaz; böylece eskimez.
- CI bunu denetler (`scripts/check-logic-docs.sh`): mantık dosyası değişip `planlogic.tsx`
  değişmediyse PR kırmızı olur. Gerçekten mantık değişmediyse (yeniden adlandırma, performans,
  yalnız test) commit mesajına ya da PR açıklamasına `[logic-docs: n/a] <neden>` yazılır.
- Mantık değişikliğine, davranışı gösteren bir test eklenir (sayfada anlatılan örnek sayı
  testteki sayıyla aynı olmalı).

## Yayın akışı

- Dal → `npm run verify` → taslak PR → CI `verify` yeşil → squash merge. `main`'e doğrudan
  push yok. Birleşen PR'ın dalını GitHub iş akışı kendisi siler.
- Yayın sunucuda `planningexpert-autodeploy.timer` ile otomatiktir (5 dakikada bir
  `scripts/deploy.sh`); elle çalıştırmak gerekmez. Ayrıntı: `deploy/README.md`.
- Şema değişince `npm run schema:snapshot`. Kararlar `docs/decisions.md`, açık işler
  `todolist.md`.

## Genel

- Kullanıcıya Türkçe, kısa ve sade yazılır; commit ve PR metinleri Türkçedir.
- Gizli değerler (jeton, anahtar, parola) çıktıya, commit'e, PR'a yazılmaz.
