#!/usr/bin/env bash
# Günlük yedek (systemd timer, her gece 02:15 — deploy/systemd/planningexpert-backup.timer):
# production verisi + dosyalar (fotoğraflar). Son 30 yedek tutulur.
# BACKUP_REMOTE tanımlıysa (Hetzner Storage Box) yedek sunucu dışına da kopyalanır;
# kopyalanamazsa betik hata verir (journalctl -u planningexpert-backup).
# Hedef: VPS'teki kendi Convex sunucumuz (scripts/convex-target.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/convex-target.sh
mkdir -p backups
FILE="backups/daily-$(date -u +%Y%m%d-%H%M%S).zip"
npx convex export --include-file-storage --path "$FILE"
test -s "$FILE" || { echo "Backup is empty"; exit 1; }
ls -1t backups/daily-*.zip | tail -n +31 | xargs -r rm --
echo "Backup written: $FILE"
if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a -e "ssh -p ${BACKUP_REMOTE_PORT:-23} -o BatchMode=yes" "$FILE" "$BACKUP_REMOTE"
  echo "Copied off-site: ${BACKUP_REMOTE}"
fi
