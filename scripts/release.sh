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
npm run verify

echo "== 2/4 backup"
mkdir -p backups
STAMP="$(date -u +%Y%m%d-%H%M%S)"
npx convex export --include-file-storage --path "backups/before-release-${STAMP}.zip"
test -s "backups/before-release-${STAMP}.zip" || { echo "Backup is empty — stopping"; exit 1; }

echo "== 3/4 + 4/4 deploy functions, then build the interface"
rm -rf convex/_generated
npx convex codegen
npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name VITE_CONVEX_URL

echo "Done (${CONVEX_TARGET}). Backup: backups/before-release-${STAMP}.zip — restart the web process: sudo systemctl restart portal"
