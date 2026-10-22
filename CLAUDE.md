# PlanningExpert — çalışma kuralları

Bu dosya depoda çalışan her Claude oturumu (bulut ya da sunucu) için geçerlidir.

## Token tasarrufu (zorunlu — her turda bütün sohbet yeniden okunur)

- **Bir iş = bir oturum.** İş bitince (PR birleşince) `/devir` skill'i: wiki + `08` satırı + açık kalanlar
  yazılır, kullanıcıya "yeni oturum aç" denir. Bağlam ~%40'ı geçerse aynı şey yapılır; yeni oturum wiki'den devam eder.
- **Büyük dosyayı bütün okuma.** Önce `grep -n` ile yeri bul, sonra `Read` ile `offset/limit` (≤150 satır).
  Büyükler (satır): `planPipeline.ts` 2245 · `scheduler.ts` 2207 · `planValidator.ts` 2009 · `oee.ts` 1769 ·
  `makineler.tsx` 1388 · `planlogic.tsx` 1387 · `takvim.tsx` 1380 · `planning.ts` 1262 · `OrgAdmin.tsx` 1261 ·
  `WeekGantt.tsx` 1100 · `convex/schema.ts` 990 · `todolist.md` 506 (yalnız ilgili bölüm).
- **Uzun çıktıyı kısalt:** `npm run verify 2>&1 | tail -40`; tek test için `npx vitest run <dosya>`;
  hata ararken `| grep -E "FAIL|Error|✗" | head -30`. `git diff` yerine `git diff --stat`, gerekirse tek dosya.
- **Geniş arama alt ajana:** birçok dosyada "nerede kullanılıyor?" taraması `Explore` ajanıyla; ana sohbete
  yalnız sonuç gelir.
- **Kısa yanıt:** yapılanı özetlemek için dosyayı tekrar okuma; Edit hata vermediyse değişiklik yapılmıştır.
  Kullanıcıya 3–6 madde, kod dökümü yok.
- Basit / mekanik iş → küçük model (kullanıcı `/model` ile seçer); motor ve mimari → güçlü model.

## Her talimattan önce: mimari etki kontrolü (zorunlu)

Yeni bir talimata **başlamadan önce** `docs/wiki/07-calisma-sozlesmesi.md` → *Yeni talimat geldiğinde* listesi
uygulanır: hangi katman, tek kaynak, motorun değişmezleri, canlı veri / şema, Planning Logic, wiki, etkilenen
yerler, geri alınabilirlik. Genel mimariye zarar veren bir değişiklik **yapılmaz**; nedeni ve alternatifi
kullanıcıya yazılır. Otomatik korumalar: `src/lib/architecture.test.ts` (katman yönü, saf hesap dosyaları,
bağımsız doğrulayıcı), `scripts/check-logic-docs.sh`, şema ve yetki testleri.

## Wiki programın kalıcı hafızasıdır (zorunlu)

Hafıza sohbette değil, `docs/wiki/` içindedir (dizin: `docs/wiki/README.md`). Bu yüzden **her iş yeni bir
oturumda** yapılabilir; işe başlarken yalnızca ilgili sayfa okunur.
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

- Dal → `npm run verify` → taslak PR → CI `verify` yeşil → squash merge. **Birleştirmeyi Claude yapar**
  (kullanıcı kararı 2026-10-22): CI yeşil ve açık yorum yoksa PR hazır yapılır ve squash merge edilir;
  kullanıcıdan beklenmez. `main`'e doğrudan
  push yok. Birleşen PR'ın dalını GitHub iş akışı kendisi siler.
- Yayın sunucuda `planningexpert-autodeploy.timer` ile otomatiktir (5 dakikada bir
  `scripts/deploy.sh`); elle çalıştırmak gerekmez. Ayrıntı: `deploy/README.md`.
- Şema değişince `npm run schema:snapshot`. Kararlar `docs/decisions.md`, açık işler
  `todolist.md`.

## Genel

- Kullanıcıya Türkçe, kısa ve sade yazılır; commit ve PR metinleri Türkçedir.
- Gizli değerler (jeton, anahtar, parola) çıktıya, commit'e, PR'a yazılmaz.
