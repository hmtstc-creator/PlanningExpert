#!/usr/bin/env bash
# Otonom döngünün kurulumu (root, idempotent). planningexpert-otonom-dogrula her çalıştığında
# önce bunu çağırır; kurulu olanı tekrar kurmaz. Döngüyü AÇMAZ: açma / kapama sitedeki
# düğmeyle olur (scripts/otonom/anahtar.sh, /etc/otonom/DURDUR).
set -euo pipefail
[ "$(id -u)" = 0 ] || exit 0
id otonom >/dev/null 2>&1 || useradd -m -s /bin/bash otonom
install -d -m 750 -o root -g otonom /etc/otonom
install -d -m 750 -o otonom -g otonom /var/lib/otonom
[ -f /var/lib/otonom/anahtar-goruldu ] || { touch /etc/otonom/DURDUR /var/lib/otonom/anahtar-goruldu; }
if [ ! -f /etc/otonom/env ]; then
  cat > /etc/otonom/env <<'ENV'
# Otonom geliştirme (wiki 13). Aç / kapat sitede: Administration → Autonomous development.
# Günlük en fazla yayın PR'ı (24 = her saat bir)
OTONOM_GUNLUK_PR=24
ENV
  chown root:otonom /etc/otonom/env
  chmod 640 /etc/otonom/env
fi
command -v claude >/dev/null || npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 || true
command -v gh >/dev/null || apt-get install -y -qq gh >/dev/null 2>&1 || true
if [ ! -d /home/otonom/PlanningExpert/.git ]; then
  sudo -u otonom git clone -q https://github.com/hmtstc-creator/PlanningExpert.git /home/otonom/PlanningExpert
fi
# Görüş pilotu: Playwright + Chromium, repodan ayrı klasörde (repoya bağımlılık eklenmez). Idempotent.
ARAC=/home/otonom/gorus-araclar
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
if [ ! -d "$ARAC/node_modules/playwright" ]; then
  install -d -o otonom -g otonom "$ARAC"
  (cd "$ARAC" && sudo -u otonom npm init -y >/dev/null && sudo -u otonom npm i --no-audit --no-fund playwright >/dev/null 2>&1 &&
    npx playwright install --with-deps chromium >/dev/null 2>&1 && chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH") ||
    echo "uyarı: Playwright/Chromium kurulamadı (görüş pilotu çalışmaz, döngü etkilenmez)"
fi
