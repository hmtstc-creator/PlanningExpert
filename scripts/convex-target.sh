# Hangi Convex'e yazılıyor? scripts/release.sh ve scripts/backup.sh bunu
# `source` eder. Tek hedef: VPS'teki kendi Convex sunucumuz (self-hosted) —
# CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY (/etc/planningexpert/portal.env).
# Başka bir Convex hesabına / bulut deployment'ına yazan anahtar tanımlıysa durur.

if [ -n "${CONVEX_DEPLOY_KEY:-}" ] || [ -n "${CONVEX_DEPLOYMENT:-}" ]; then
  echo "Refusing: CONVEX_DEPLOY_KEY / CONVEX_DEPLOYMENT is set — this project runs only on its own server (CONVEX_SELF_HOSTED_URL)." >&2
  exit 1
fi

: "${CONVEX_SELF_HOSTED_URL:?CONVEX_SELF_HOSTED_URL is not set (set -a; . /etc/planningexpert/portal.env; set +a)}"
: "${CONVEX_SELF_HOSTED_ADMIN_KEY:?CONVEX_SELF_HOSTED_ADMIN_KEY is not set (docker compose exec backend ./generate_admin_key.sh)}"
CONVEX_TARGET="self-hosted ${CONVEX_SELF_HOSTED_URL}"
# CLI sunucuda yerelden bağlanır (http://127.0.0.1:3210); site dışarıdan
# görünen adresle (CONVEX_PUBLIC_URL, Funnel) derlenir.
export VITE_CONVEX_URL="${CONVEX_PUBLIC_URL:-$CONVEX_SELF_HOSTED_URL}"
echo "Convex target: ${CONVEX_TARGET}"
