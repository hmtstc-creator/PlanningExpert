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
#   scripts/deploy.sh          main'de yeni commit yoksa hiçbir şey yapmaz
#   scripts/deploy.sh --force  yeni commit olmasa da yeniden yayınlar
#
# Betik git pull ile kendini değiştirebilir; bash bir işlevi çalıştırmadan önce
# bütünüyle okuduğu için gövde main() içinde.
set -euo pipefail

main() {
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

  local before after
  before=$(git rev-parse --short HEAD)
  git fetch -q origin main
  git merge --ff-only -q origin/main
  after=$(git rev-parse --short HEAD)
  if [ "$before" = "$after" ] && [ "$force" = 0 ]; then
    echo "HEAD ${after}: already up to date — nothing to deploy (use --force to redeploy)."
    exit 0
  fi
  echo "HEAD ${before} -> ${after}"
  git log --oneline "${before}..${after}" | head -20

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
    echo "STOP: release failed — the site was NOT restarted."
    exit "$rc"
  fi

  docker compose -f deploy/compose.yml restart web >/dev/null 2>&1
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
  [ "$code" = 200 ] || { echo "WARNING: the site did not answer 200 locally."; exit 3; }
}

main "$@"
exit
