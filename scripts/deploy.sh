#!/usr/bin/env bash
# Tek komutla yayın (sunucuda): main'i çek → release.sh (yedek, Convex, site) →
# siteyi yeniden başlat → kontrol ve kısa rapor. deploy/README.md → Güncelleme.
#
# Sunucudaki Claude oturumu her yayında yalnızca bu betiği çalıştırır; böylece
# tek bir kalıcı izin yeter (planlamacı, 2026-10-20: her komut için onay
# istenmesin). Kurallar README'deki gibi: bellek 1 GB'ın altındaysa durur,
# yalnızca main ileri sarılır (ff-only), Karabasan'a dokunulmaz, gizli değerler
# çıktıya yazılmaz.
#
#   scripts/deploy.sh          yayındaki commit main'in ucuysa hiçbir şey yapmaz
#   scripts/deploy.sh --force  yeni commit olmasa da yeniden yayınlar
#
# Otomatik yayın: planningexpert-autodeploy.timer bu betiği 5 dakikada bir
# çalıştırır. Yayındaki commit $STATE/deployed-commit'te tutulur; bir commit
# başarısız olursa $STATE/failed-commit'e yazılır ve yeni bir commit gelene
# (ya da --force) kadar yeniden denenmez — her 5 dakikada yedek alınmasın.
#
# Betik git pull ile kendini değiştirebilir; bash bir işlevi çalıştırmadan önce
# bütünüyle okuduğu için gövde main() içinde.
set -euo pipefail

# deploy/systemd'deki zamanlayıcıları sisteme kurar ya da günceller (değiştiyse):
# otomatik yayın ve gece yedeği. Böylece yeni bir birim için ayrıca izin gerekmez.
install_units() {
  command -v systemctl >/dev/null 2>&1 || return 0
  local changed=0 f name
  for f in deploy/systemd/planningexpert-*.service deploy/systemd/planningexpert-*.timer; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    if ! cmp -s "$f" "/etc/systemd/system/${name}"; then
      install -m 644 "$f" "/etc/systemd/system/${name}"
      changed=1
      echo "systemd: ${name} installed"
    fi
  done
  [ "$changed" = 1 ] && systemctl daemon-reload
  for f in deploy/systemd/planningexpert-*.timer; do
    name=$(basename "$f")
    systemctl is-enabled -q "$name" 2>/dev/null || { systemctl enable --now -q "$name" && echo "systemd: ${name} enabled"; }
  done
  return 0
}

main() {
  # Tek yayın: elle çalıştırma ve otomatik zamanlayıcı aynı kilidi alır. İlk
  # kurulumda `enable --now` zamanlayıcıyı hemen tetikler; o ikinci çalıştırma
  # burada sessizce çıkar (2026-10-22: iki yayın paralel koştu, biri yedekte kaldı).
  exec 9>/run/planningexpert-deploy.lock
  if ! flock -n 9; then
    echo "another deploy is running — nothing to do."
    exit 0
  fi
  local force=0
  [ "${1:-}" = "--force" ] && force=1
  cd "$(dirname "$0")/.."

  local avail
  avail=$(free -m | awk '/^Mem:/ {print $7}')
  echo "memory: ${avail} MB available"
  if [ "$avail" -lt 1024 ]; then
    echo "STOP: less than 1 GB available — not deploying."
    exit 2
  fi

  local state=/var/lib/planningexpert
  mkdir -p "$state"
  local before after deployed failed
  before=$(git rev-parse --short HEAD)
  git fetch -q origin main
  git merge --ff-only -q origin/main
  after=$(git rev-parse --short HEAD)
  # Kayıt yoksa (ilk otomatik yayın) yayındaki sürüm bilinmiyor: bir kez yayınlanır.
  deployed=$(cat "$state/deployed-commit" 2>/dev/null || echo "unknown")
  failed=$(cat "$state/failed-commit" 2>/dev/null || true)
  if [ "$force" = 0 ]; then
    if [ "$deployed" = "$after" ]; then
      install_units
      echo "HEAD ${after}: already live — nothing to deploy (use --force to redeploy)."
      exit 0
    fi
    if [ "$failed" = "$after" ]; then
      echo "HEAD ${after}: the last deploy of this commit failed — not retrying (fix it on main or use --force)."
      exit 0
    fi
  fi
  install_units
  echo "live ${deployed} -> ${after}"
  if [ "$deployed" != unknown ]; then git log --oneline "${deployed}..${after}" 2>/dev/null | head -20 || true; fi

  set -a
  # shellcheck disable=SC1091
  . /etc/planningexpert/portal.env
  set +a
  # Yalnızca kendi Convex sunucumuz (scripts/convex-target.sh bunu da denetler).
  unset CONVEX_DEPLOY_KEY CONVEX_DEPLOYMENT

  local t0 log rc
  t0=$(date +%s)
  log=$(mktemp)
  set +e
  SKIP_LOCAL_VERIFY=1 ./scripts/release.sh >"$log" 2>&1
  rc=$?
  set -e
  # Rapor: önemli satırlar, gizli değerler maskelenmiş.
  grep -E 'Deployed|Schema|indexes|✖|rror|Done|Refusing|Backup' "$log" | grep -v -E 'MODULE_LEVEL|ErrorBanner' |
    sed -E 's/[A-Za-z0-9_-]+\|[0-9a-f]{20,}/<SECRET>/g; s/[0-9a-f]{48,}/<SECRET>/g; s/\x1b\[[0-9;]*m//g' | cut -c1-200 || true
  if [ "$rc" != 0 ]; then
    echo "--- last lines of release.sh ---"
    tail -n 30 "$log" | sed -E 's/[A-Za-z0-9_-]+\|[0-9a-f]{20,}/<SECRET>/g; s/[0-9a-f]{48,}/<SECRET>/g; s/\x1b\[[0-9;]*m//g' | cut -c1-200
  fi
  rm -f "$log"
  echo "release.sh: exit ${rc}, $(($(date +%s) - t0)) s"
  chmod 600 backups/*.zip 2>/dev/null || true
  if [ "$rc" != 0 ]; then
    echo "$after" >"$state/failed-commit"
    echo "STOP: release failed — the site was NOT restarted."
    exit "$rc"
  fi

  docker compose -f deploy/compose.yml restart web >/dev/null 2>&1
  # SOP işleyicisi yalnız kurulduysa (deploy/.env → SOP_WORKER_TOKEN): yeni kodla yeniden başlar.
  if grep -q '^SOP_WORKER_TOKEN=.' deploy/.env 2>/dev/null; then
    docker compose -f deploy/compose.yml up -d --build sop-worker >/dev/null 2>&1 &&
      docker compose -f deploy/compose.yml restart sop-worker >/dev/null 2>&1 &&
      echo "sop-worker: restarted" || echo "sop-worker: could not start (docker compose logs sop-worker)"
  fi
  local code=000 i
  for i in $(seq 1 20); do
    code=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null || true)
    [ "$code" = 200 ] && break
    sleep 2
  done
  echo "site (local): ${code}"
  if [ -n "${CONVEX_PUBLIC_URL:-}" ]; then
    echo "site (funnel): $(curl -s -m 30 -o /dev/null -w '%{http_code}' "${CONVEX_PUBLIC_URL%:8443}/" || true)"
  fi
  docker compose -f deploy/compose.yml ps --format '{{.Name}}\t{{.Status}}'
  docker inspect planningexpert-backend-1 --format 'backend: restart={{.RestartCount}} oom={{.State.OOMKilled}}' 2>/dev/null || true
  free -m | sed -n '2,3p'
  echo "karabasan: $(docker ps --filter name=kb- --format '{{.Names}}' | wc -l) containers up (not touched)"
  if [ "$code" != 200 ]; then
    echo "$after" >"$state/failed-commit"
    echo "WARNING: the site did not answer 200 locally."
    exit 3
  fi
  echo "$after" >"$state/deployed-commit"
  rm -f "$state/failed-commit"
  echo "live: ${after}"
}

main "$@"
exit
