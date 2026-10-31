#!/usr/bin/env bash
# Sitedeki Administration → Autonomous development düğmesini sunucuya taşır (root, 5 dakikada bir).
# Düğme kapalıysa (varsayılan) ya da okunamazsa /etc/otonom/DURDUR konur; açıksa kaldırılır.
set -uo pipefail
cd /opt/planningexpert || exit 1
./scripts/otonom/kur.sh || true
set -a
# shellcheck disable=SC1091
. /etc/planningexpert/portal.env
set +a
unset CONVEX_DEPLOY_KEY CONVEX_DEPLOYMENT
cevap=$(timeout 60 npx --no-install convex run otonom:aktifMi 2>/dev/null | tr -d '[:space:]')
if [ "$cevap" = true ]; then
  [ -e /etc/otonom/DURDUR ] && rm -f /etc/otonom/DURDUR && echo "otonom: AÇIK (siteden)"
else
  [ -e /etc/otonom/DURDUR ] || { touch /etc/otonom/DURDUR && echo "otonom: KAPALI (site: ${cevap:-okunamadı})"; }
fi
exit 0
