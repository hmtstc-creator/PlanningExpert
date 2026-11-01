#!/usr/bin/env bash
# Görüş pilotu (wiki 13): roller sayfayı gerçek tarayıcıda görüp rapor yazar. YALNIZ OKUR:
# kod yazmaz, PR açmaz, canlı veriye dokunmaz. Elle çalıştırılır (zamanlayıcı yok):
#   sudo -u otonom bash /home/otonom/PlanningExpert/scripts/otonom/gorus.sh
# Çıktı: /var/lib/otonom/gorus/<zaman>/ (ekran görüntüsü, ölçüm JSON'u, rapor, ozet.md)
. "$(dirname "$0")/ortak.sh"
set -a; . "$OTONOM_ETC/env"; set +a
[ -n "${OTONOM_BASE_URL:-}" ] && [ -n "${OTONOM_TEST_KULLANICI:-}" ] && [ -n "${OTONOM_TEST_PAROLA:-}" ] ||
  { log "eksik: /etc/otonom/env içinde OTONOM_BASE_URL, OTONOM_TEST_KULLANICI, OTONOM_TEST_PAROLA"; exit 1; }
ARAC=${GORUS_ARAC:-/home/otonom/gorus-araclar}
repo_esitle
ZAMAN=$(date +%Y%m%d-%H%M)
OUT=$OTONOM_STATE/gorus/$ZAMAN
mkdir -p "$OUT"

# Ölçüm: Playwright, kendi araç klasöründen (repoya bağımlılık eklenmez)
( cd "$ARAC" && node "$OTONOM_REPO/scripts/otonom/gorus.mjs" "$OUT" "$OTONOM_REPO/scripts/otonom/gorus-senaryo.json" ) ||
  { log "ölçüm başarısız"; exit 1; }

# Her rol için rapor: haiku'dan başlar, geçerli JSON gelmezse bir üst model (CLAUDE.md kuralı)
for olcum in "$OUT"/*.json; do
  base=${olcum%.json}
  for m in haiku sonnet opus; do
    { cat "$OTONOM_REPO/scripts/otonom/gorus-prompt.md"; echo; echo "## Ölçüm"; cat "$olcum"; } |
      claude_sor "$m" > "$base.rapor.txt" 2>&1
    node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8");JSON.parse(t.slice(t.indexOf("{"),t.lastIndexOf("}")+1))' "$base.rapor.txt" 2>/dev/null && { log "rapor $(basename "$base"): $m"; break; }
  done
done

{
  echo "# Görüş pilotu — $ZAMAN"
  for r in "$OUT"/*.rapor.txt; do
    echo; echo "## $(basename "${r%.rapor.txt}")"; cat "$r"
  done
} > "$OUT/ozet.md"
log "bitti: $OUT/ozet.md"
