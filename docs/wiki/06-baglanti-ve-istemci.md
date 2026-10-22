# 06 · Bağlantı ve istemci taşıması

> Son güncelleme: 2026-10-22 · Kaynak: `src/lib/convexTransport.tsx`, `src/components/ConnectionBanner.tsx`, `src/routes/tani.tsx`

Convex istemcisi canlı veriyi **WebSocket** ile taşır. Kurumsal güvenlik duvarları HTTPS'e izin verip WebSocket'i kesebildiği için
uygulamanın **yedek taşıması** vardır: saf HTTPS (`ConvexHttpClient`, 20 saniyede bir yenileme).

## Karar mantığı

- WebSocket **7 sn** içinde açılmazsa → HTTPS.
- Açıldıktan sonra küçük bir **deneme sorgusu** (`authInternal:me`) gönderilir; **8 sn** içinde cevap gelmezse → HTTPS (`ws.state = 'silent'`).
  (Bazı güvenlik duvarları bağlantıyı açar ama mesajları tutar.)
- **Düzeltme (PR #20, 2026-10-22):** deneme sorgusu 8 sn'den sonra da dinlenir; cevap sonradan gelirse **canlı moda bir kez geri dönülür**.
  Eskiden karar sayfa kapanana kadar kalıcıydı: yavaş mobil hatta ya da yayın sonrası meşgul sunucuda bütün oturum yedek modda kalıyordu.
- `useTransport()` → `{ mode: 'connecting' | 'websocket' | 'http', ws: { state: 'closed' | 'open' | 'silent' | 'verified', answerMs } }`.

## Ekranlar

- **Sarı bant** (her sayfa): yalnızca `mode === 'http'`. Metin "bağlantı kurulamadı" ile "açık ama cevap vermedi" arasında ayrım yapar.
- **Connection Diagnostics** (`/tani`): soket açık ama `mode === 'http'` ise "healthy" **yazmaz** (eskiden yazıyor, banner ile çelişiyordu);
  *Live data check* satırı cevap süresini gösterir; *Version on this site* yayındaki commit'i gösterir.

## Tuzaklar

- Taşıma modu değişince açık sorgular yeniden abone olur; bu yüzden geri dönüş **bir kez** yapılır (`verified` kalıcıdır).
- Yazma ve action'lar WebSocket'ten bağımsız HTTPS'ten gider; "Saving works" doğrudur.
- Tarayıcıdan GitHub API'sine sorgu **yapılamaz** (CSP); yayın bilgisi derlemeye gömülür (`VITE_BUILD_*`).
