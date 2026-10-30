#!/usr/bin/env bash
# :50 — son birleşen değişiklik yayında mı? (root). Değilse otomatik yayını hemen tetikler,
# bitmesini bekler ve sonucu yazar. Önce kur.sh (idempotent).
set -uo pipefail
cd /opt/planningexpert || exit 1
./scripts/otonom/kur.sh || true
[ -e /etc/otonom/DURDUR ] && exit 0
git fetch -q origin main
hedef=$(git rev-parse --short origin/main)
canli=$(cat /var/lib/planningexpert/deployed-commit 2>/dev/null || echo yok)
if [ "$hedef" != "$canli" ]; then
  echo "yayında $canli, main $hedef — yayın tetikleniyor"
  systemctl start planningexpert-autodeploy.service   # oneshot: bitene kadar bekler
  canli=$(cat /var/lib/planningexpert/deployed-commit 2>/dev/null || echo yok)
fi
echo "$(date '+%F %T') main=$hedef canli=$canli" >> /var/lib/otonom/dogrula.log
if [ "$hedef" = "$canli" ]; then echo "tamam: $canli yayında"; else echo "UYARI: $hedef yayına çıkmadı"; exit 1; fi
