#!/usr/bin/env bash
# Yayın (docs/deployment.md → Veri güvenliği). Sıra bozulmaz:
#   1. doğrulama (tip + test + şema kapısı + build) — kırmızıysa durur
#   2. production verisinin yedeği (dosyalar dahil) — alınamazsa durur
#   3. Convex işlevleri ve şema — Convex, mevcut veriye uymayan şemayı reddeder
#   4. arayüz build'i (Convex adresiyle)
# Hedef: kendi sunucumuzdaki Convex (CONVEX_SELF_HOSTED_URL + _ADMIN_KEY) ya da
# Convex Cloud production (CONVEX_DEPLOY_KEY, "prod:") — scripts/convex-target.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/convex-target.sh

echo "== 1/4 verify"
npm ci
if [ "${SKIP_LOCAL_VERIFY:-}" = "1" ]; then
  # Küçük sunucu (botlarla aynı makine): testler CI'da koşar; yalnızca CI'da yeşil commit yayınlanır.
  echo "Skipping local tests (SKIP_LOCAL_VERIFY=1) — commit $(git rev-parse --short HEAD) must be green in CI."
else
  npm run verify
fi

echo "== 2/4 backup"
mkdir -p backups
STAMP="$(date -u +%Y%m%d-%H%M%S)"
npx convex export --include-file-storage --path "backups/before-release-${STAMP}.zip"
test -s "backups/before-release-${STAMP}.zip" || { echo "Backup is empty — stopping"; exit 1; }

echo "== 3/4 + 4/4 deploy functions, then build the interface"
rm -rf convex/_generated
npx convex codegen
if [ -n "${CONVEX_SELF_HOSTED_URL:-}" ]; then
  # Kendi sunucumuz: önce işlevler, sonra site — sitenin adresi VITE_CONVEX_URL (Funnel).
  npx convex deploy
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}" npm run build
else
  npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL
fi

echo "Done (${CONVEX_TARGET}). Backup: backups/before-release-${STAMP}.zip — restart the site: docker compose -f deploy/compose.yml restart web"
