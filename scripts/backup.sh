#!/usr/bin/env bash
# Günlük yedek (cron, ör. her gece 02:15): production verisi + dosyalar.
# Son 30 yedek tutulur; yedekler ayrıca sunucu dışına kopyalanmalı (S3 vb.).
# Gerekli: CONVEX_DEPLOY_KEY (production).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${CONVEX_DEPLOY_KEY:?CONVEX_DEPLOY_KEY is not set}"
mkdir -p backups
FILE="backups/daily-$(date -u +%Y%m%d-%H%M%S).zip"
npx convex export --include-file-storage --path "$FILE"
test -s "$FILE" || { echo "Backup is empty"; exit 1; }
ls -1t backups/daily-*.zip | tail -n +31 | xargs -r rm --
echo "Backup written: $FILE"
