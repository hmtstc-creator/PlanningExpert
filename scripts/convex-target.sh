# Hangi Convex'e yazılıyor? scripts/release.sh ve scripts/backup.sh bunu
# `source` eder. İkisinden yalnızca biri tanımlı olmalı:
#   - Kendi sunucumuz (self-hosted): CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY
#   - Convex Cloud production:      CONVEX_DEPLOY_KEY (prod:…)
# İkisi birden tanımlıysa durur: hangi veritabanına yazıldığı hiçbir zaman belirsiz kalmaz.

if [ -n "${CONVEX_SELF_HOSTED_URL:-}" ] && [ -n "${CONVEX_DEPLOY_KEY:-}" ]; then
  echo "Refusing: both CONVEX_SELF_HOSTED_URL and CONVEX_DEPLOY_KEY are set — set only the target you mean." >&2
  exit 1
fi

if [ -n "${CONVEX_SELF_HOSTED_URL:-}" ]; then
  : "${CONVEX_SELF_HOSTED_ADMIN_KEY:?CONVEX_SELF_HOSTED_ADMIN_KEY is not set (docker compose exec backend ./generate_admin_key.sh)}"
  CONVEX_TARGET="self-hosted ${CONVEX_SELF_HOSTED_URL}"
  export VITE_CONVEX_URL="$CONVEX_SELF_HOSTED_URL"
else
  : "${CONVEX_DEPLOY_KEY:?Set CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY (own server) or CONVEX_DEPLOY_KEY (Convex Cloud production)}"
  case "$CONVEX_DEPLOY_KEY" in
    prod:*) ;;
    *) echo "Refusing: CONVEX_DEPLOY_KEY is not a production key (prod:...)" >&2; exit 1 ;;
  esac
  CONVEX_TARGET="Convex Cloud production"
fi
echo "Convex target: ${CONVEX_TARGET}"
