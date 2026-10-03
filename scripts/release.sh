#!/usr/bin/env bash
# Yayın (docs/deployment.md → Veri güvenliği). Sıra bozulmaz:
#   1. doğrulama (tip + test + şema kapısı + build) — kırmızıysa durur
#   2. production verisinin yedeği (dosyalar dahil) — alınamazsa durur
#   3. Convex işlevleri ve şema — Convex, mevcut veriye uymayan şemayı reddeder
#   4. arayüz build'i (Convex adresiyle)
# Gerekli: CONVEX_DEPLOY_KEY (production, "prod:" ile başlar).
set -euo pipefail
cd "$(dirname "$0")/.."

: "${CONVEX_DEPLOY_KEY:?CONVEX_DEPLOY_KEY is not set (production deploy key)}"
case "$CONVEX_DEPLOY_KEY" in
  prod:*) ;;
  *) echo "Refusing: CONVEX_DEPLOY_KEY is not a production key (prod:...)"; exit 1 ;;
esac

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

echo "Done. Backup: backups/before-release-${STAMP}.zip — restart the web process (systemd / pm2)."
