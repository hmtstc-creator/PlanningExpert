# PlanningExpert

Pres üretimi için kiralanan, çok şirketli üretim planlama portalı:
PlanningExpert (plan), OEE, KPI, Die Follow-up, Machine Follow-up ve Board
Dashboard. Tek sistem, tek adres; her plant'in verisi ayrıdır.

- Arayüz: React 19 + TanStack Start/Router + Tailwind v4 (Vercel)
- Sunucu ve veritabanı: Convex
- Hesap kütüphanesi: `src/lib` (saf TypeScript, React'e ve Convex'e bağlı değil)

## Belgeler

| Dosya | İçerik |
|---|---|
| `todolist.md` | **Bütün açık işler ve kararlar** — tek liste |
| `docs/architecture.md` | Katmanlar, tek kaynak haritası, geliştirme kuralları |
| `docs/decisions.md` | Planlama kararları (takvim, kapasite, setup, hammadde) |
| `docs/fixeddefinitions.md` | Koddaki sabit sayılar (programda mı, kullanıcıda mı) |
| `docs/plant-genisletme.md` | Çok şirket / çok plant ve yetki modeli |
| `docs/board.md` | Holding, Board Dashboard, organizasyon ağacı |
| `docs/oeedashboard.md` | OEE kararları ve dosya biçimi |
| `docs/kpi.md` | KPI modülü |
| `docs/deployment.md` | VPS'e dağıtım, Convex Cloud / self-hosted kararı |
| Sitede **Planning Logic** | Kullanıcıya dönük plan kuralları |

## Organizasyon

```
Holding → Company → Plant → Department → Cost center → Work center
```

Tepeden aşağı kurulur: şirket bir holding'in, cost center bir bölümün, work
center bir cost center'ın altında açılır (Company settings → Organization, Work Center
Definitions). Kiralama birimi şirkettir: kullanıcılar, gruplar, modüller.
Yetki = grup × plant × modül (*yok · görür · düzenler*).

## Kurulum ve geliştirme

```bash
npm install
npm run dev            # arayüz (http://localhost:3000)
npx convex dev         # Convex işlevlerini izler ve deploy eder (.env.local)
```

## Doğrulama (her değişiklikten önce)

```bash
npm run verify         # tip kontrolü + bütün testler + build
```

Aynısı her push'ta GitHub Actions'ta koşar (`.github/workflows/ci.yml`).
Kırmızı CI = main bozuk; önce o düzeltilir.

## Yayın (deploy)

Site VPS'e taşınıyor: adımlar ve "Convex nerede çalışacak" kararı
**docs/deployment.md**'de. Özet: `npm run verify` → `npx convex deploy` →
`npm run build` → `node .output/server/index.mjs`.

## Yedek ve geri yükleme

- **Convex yedeği:** Convex panelinde production deployment → *Backup &
  Restore*: periyodik (günlük) yedek açılır; plan bunu desteklemiyorsa en
  azından her büyük değişiklikten önce *Backup now*. Ayda bir, yedek boş bir
  deployment'a geri yüklenerek denenir (todolist.md 4.1).
- **Şirket dışa aktarımı:** Company settings → Organization → şirket → *Export data
  (JSON)*: o şirketin bütün plant verisi tek dosya (kiralama bitince ya da
  elle yedek).

## Ekranın yapısı

- Üst çubuk her yerde aynı: logo (portal) · modül ▾ · modülün menüsü ·
  Şirket › Plant ▾ · kullanıcı ▾.
- Kullanıcı menüsü: **My account** (herkes; parola), **Company settings**
  (creator: plant / bölüm / cost center, kullanıcılar, gruplar, listeler,
  geçmiş), **Administration** (yalnızca General: holding, şirket, General'ler,
  platform geçmişi, sistem hataları), Connection diagnostics, Sign out.

## İzleme ve kayıtlar

- **System errors** (Administration, yalnızca General): çöken sayfalar
  ve başarısız plan hesapları.
- **History / Platform history**: kullanıcı, parola, yetki, şirket, plant,
  bölüm ve cost center değişiklikleri (kim, ne zaman, eski → yeni).
- **Change Log** (System menüsü): plant içindeki değişiklikler.

## Giriş ve güvenlik

- Parolalar PBKDF2-SHA512 + kullanıcıya özel tuzla saklanır; oturum 12 saat.
- Yeni parola en az 8 karakter, harf + rakam; art arda 5 hatalı parolada
  hesap 15 dakika kilitlenir (creator yeni parola verince açılır).
- Boş kurulumda ilk hesap `admin` / `admin` olarak açılır ve ilk girişte
  değiştirilmesi zorunludur. Parola unutulursa: creator yeni geçici parola
  verir; site sahibinin parolası Convex panelinden `auth:resetPassword` ile
  sıfırlanır.

## Yeni plant kurulumu

Portal ana sayfasındaki kurulum listesi sırayla yol gösterir: ülke ve saat
dilimi → bölümler ve cost center'lar → work center'lar (cost center + hol) →
Work Calendar → Storage Locations → Master Data → SAP verileri → OEE →
kullanıcılar ve gruplar.

## Sorun giderme: "Telefonda girdiğim veri bilgisayarda görünmüyor"

İki cihaz farklı Convex deployment'ına bakıyordur.

1. **System → Connection Diagnostics** sayfasını iki cihazda da aç.
2. **Deployment** adlarını karşılaştır.
3. Farklıysa build başka bir Convex deployment'ına bakıyordur (preview
   anahtarı ya da başka adres); production'ınkiyle yeniden build et.
4. Aynıysa ve sayılar farklıysa tarayıcı önbelleğidir — sayfayı yenile.

## Notlar

- Proje Macaly'den dışa aktarıldı; `src/components/ui` (shadcn) pakette yok,
  gerekirse `npx shadcn@latest add <bileşen>`.
- Şemada `@deprecated` işaretli alanlar eski verinin okunması için duruyor;
  silinmeleri bir geçiş gerektirir (todolist.md 4.2).
