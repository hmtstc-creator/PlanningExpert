#!/usr/bin/env bash
# :00 — eleştiri toplantısı (wiki 13). Okur: durum.md + harita + odak sayfanın başı (T1–T3).
# Yazar: kuyruk/<zaman>-<n>.json. Kuyrukta iş varsa toplantı atlanır (T9).
. "$(dirname "$0")/ortak.sh"
otonom_acik_mi || exit 0
kilit_al 300
repo_esitle
if [ "$(ls "$KUYRUK" | wc -l)" -ge 2 ]; then log "kuyrukta iş var — toplantı atlandı"; exit 0; fi

mapfile -t ROTALAR < <(find src/routes -name '*.tsx' ! -name '*.test.*' ! -name planlogic.tsx | sort)
SIRA=$(( $(cat "$OTONOM_STATE/sira" 2>/dev/null || echo 0) % ${#ROTALAR[@]} ))
ODAK=${ROTALAR[$SIRA]}
echo $((SIRA + 1)) > "$OTONOM_STATE/sira"
ZAMAN=$(date +%Y%m%d-%H%M)
log "toplantı $ZAMAN — odak: $ODAK"

{
  cat scripts/otonom/toplanti-prompt.md
  echo; echo "## Durum özeti"; cat docs/otonom/durum.md 2>/dev/null
  echo; echo "## Sayfa ilişki haritası"; node scripts/otonom/harita.mjs
  echo; echo "## Odak sayfa: $ODAK (ilk 220 satır)"; head -n 220 "$ODAK"
} > "$OTONOM_STATE/son-toplanti-girdi.md"

claude_sor sonnet < "$OTONOM_STATE/son-toplanti-girdi.md" > "$OTONOM_STATE/son-toplanti.txt" || { log "claude hata"; exit 1; }

node - "$OTONOM_STATE/son-toplanti.txt" "$KUYRUK" "$ZAMAN" "$ODAK" "$OTONOM_STATE/toplantilar.jsonl" <<'JS'
const fs = require('fs')
const [, , giris, kuyruk, zaman, odak, kayit] = process.argv
const metin = fs.readFileSync(giris, 'utf8')
const j = JSON.parse(metin.slice(metin.indexOf('{'), metin.lastIndexOf('}') + 1))
const yasak = /planPipeline|scheduler|planValidator|planning\.ts|oee|rawMrp|rawLeadTime|schema\.ts|planlogic|package|^deploy\/|^scripts\/|^docs\//
const gorevler = (j.gorevler || []).slice(0, 3).filter((g) => g.gorev && !(g.dosyalar || []).some((d) => yasak.test(d)))
gorevler.forEach((g, i) =>
  fs.writeFileSync(`${kuyruk}/${zaman}-${i + 1}.json`, JSON.stringify({ ...g, id: `${zaman}-${i + 1}`, odak, toplanti: zaman }, null, 1)),
)
fs.appendFileSync(kayit, JSON.stringify({ zaman, odak, ozet: j.ozet, gorev: gorevler.length, oneriler: j.oneriler || [] }) + '\n')
console.log(`görev: ${gorevler.length}`)
JS
