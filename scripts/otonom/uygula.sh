#!/usr/bin/env bash
# :05 — kuyruktaki her görevi Gemini yazar, yerelde verify yeşile çevrilir (scripts/qwen-yesil.sh,
# aynı korunan dosya / boyut sınırları), ucuz Claude (haiku) diff'i onaylar (T5–T7).
# Onaylanan görev hazir/<id>.patch olur. 32 dakikada durur, kalan sonraki saate.
. "$(dirname "$0")/ortak.sh"
otonom_acik_mi || exit 0
kilit_al 600
repo_esitle
BITIS=$(( $(date +%s) + 32 * 60 ))
for f in "$KUYRUK"/*.json; do
  [ -f "$f" ] || break
  [ "$(date +%s)" -lt "$BITIS" ] || { log "süre doldu — kalanlar sonraki saate"; break; }
  id=$(basename "$f" .json)
  log "görev $id"
  temizle
  gorev=$(node -e 'const g=require(process.argv[1]);console.log(g.gorev+"\nFiles: "+(g.dosyalar||[]).join(", "))' "$f")
  QWEN_ONCE=gemini QWEN_TUR=4 QWEN_GOREV="$gorev" timeout 1500 ./scripts/qwen-yesil.sh > "$OTONOM_STATE/son-uygula.txt" 2>&1
  rc=$?
  git add -A && git reset -q -- qwen-rapor.md .qwen-verify.txt 2>/dev/null
  if [ "$rc" != 0 ] || git diff --cached --quiet; then
    log "görev $id: başarısız (rc=$rc)"; mv "$f" "$BITEN/$id.basarisiz.json"; continue
  fi
  { cat scripts/otonom/onay-prompt.md; echo; echo "## Görev"; echo "$gorev"; echo; echo "## Diff"; git diff --cached | head -n 600; } |
    claude_sor haiku > "$OTONOM_STATE/son-onay.txt"
  if head -n 1 "$OTONOM_STATE/son-onay.txt" | grep -q '^ONAY'; then
    git diff --cached --binary > "$HAZIR/$id.patch"
    mv "$f" "$HAZIR/$id.json"
    log "görev $id: onaylandı"
  else
    log "görev $id: $(head -n 1 "$OTONOM_STATE/son-onay.txt")"; mv "$f" "$BITEN/$id.red.json"
  fi
done
temizle
