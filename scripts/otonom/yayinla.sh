#!/usr/bin/env bash
# :40 — hazır görevler tek dalda toplanır, tam verify, tek PR, CI yeşile dönene kadar (Gemini
# düzeltir, en çok 3 tur; olmazsa PR kapanır, main bozulmaz), squash merge. Otonom Gelişim
# kaydı (src/data/otonom-gunluk.json) ve durum.md aynı PR'da güncellenir.
. "$(dirname "$0")/ortak.sh"
otonom_acik_mi || exit 0
kilit_al 900
repo_esitle
ZAMAN=$(date +%Y%m%d-%H%M)
DAL="otonom/yayin-$ZAMAN"
BUGUN=$(gh pr list -R "$REPO_SLUG" --state merged --search "head:otonom/yayin-$(date +%Y%m%d)" --json number -q length 2>/dev/null || echo 0)
[ "$BUGUN" -lt "${OTONOM_GUNLUK_PR:-24}" ] || { log "günlük PR sınırı doldu"; exit 0; }

# Hazır görevlerin taşınması: yayinda / ci-basarisiz (patch dosyası biten/'e gider, silinmez).
tasi() { # $1 son ek, $2.. id
  local ek=$1 id; shift
  for id in "$@"; do mv "$HAZIR/$id.json" "$BITEN/$id.$ek.json"; mv "$HAZIR/$id.patch" "$BITEN/$id.$ek.patch"; done
}

mapfile -t IDLER < <(find "$HAZIR" -name '*.patch' -printf '%f\n' | sed 's/\.patch$//' | sort)
git checkout -q -b "$DAL"
ALINAN=()
for id in "${IDLER[@]}"; do
  if git apply --3way "$HAZIR/$id.patch" 2>/dev/null; then ALINAN+=("$id"); else log "çakışma: $id sonraki saate"; git checkout -q -- . ; fi
done
# Toplu verify: kırmızıysa sondan bir görev çıkarılır.
while [ "${#ALINAN[@]}" -gt 0 ] && ! npm run verify > "$OTONOM_STATE/son-verify.txt" 2>&1; do
  son=${ALINAN[-1]}; unset 'ALINAN[-1]'; log "toplu verify kırmızı — $son çıkarıldı"
  git apply -R "$HAZIR/$son.patch" 2>/dev/null || { temizle; exit 1; }
  tasi toplu-basarisiz "$son"
done

node scripts/otonom/gunluk.mjs "$ZAMAN" "$HAZIR" "$OTONOM_STATE/toplantilar.jsonl" "${ALINAN[@]}"
node scripts/otonom/harita.mjs > docs/otonom/harita.md
git add -A
git -c user.name="otonom" -c user.email="otonom@planningexpert" commit -qm "Otonom gelişim $ZAMAN: ${#ALINAN[@]} iyileştirme

[logic-docs: n/a] otonom döngü yalnız arayüz / sayfa ilişkisi değiştirir (korunan dosyalar yasak)"
git push -q -u origin "$DAL" || exit 1
gh pr create -R "$REPO_SLUG" -H "$DAL" -B main -t "Otonom gelişim $ZAMAN (${#ALINAN[@]} iyileştirme)" \
  -b "Saatlik eleştiri toplantısı çıktısı. Ayrıntı: src/data/otonom-gunluk.json · wiki 13. [logic-docs: n/a]" >/dev/null || exit 1

# CI yeşile dönene kadar (yarıda bırakılmaz); test atlamak / kapatmak yasak.
for tur in 1 2 3 4; do
  sleep 20
  if gh pr checks "$DAL" -R "$REPO_SLUG" --watch --fail-fast > "$OTONOM_STATE/son-ci.txt" 2>&1; then
    if gh pr merge "$DAL" -R "$REPO_SLUG" --squash --delete-branch; then
      tasi yayinda "${ALINAN[@]}"; log "yayında: $DAL"; temizle; exit 0
    fi
  fi
  [ "$tur" = 4 ] && break
  run=$(gh run list -R "$REPO_SLUG" -b "$DAL" -L 1 --json databaseId -q '.[0].databaseId')
  hata=$(gh run view "$run" -R "$REPO_SLUG" --log-failed 2>/dev/null | tail -n 40)
  log "CI kırmızı (tur $tur) — Gemini düzeltiyor"
  QWEN_ONCE=gemini QWEN_TUR=3 QWEN_GOREV="CI failed on this branch. Fix the root cause; never skip or disable a test. Last log lines: $hata" \
    timeout 1500 ./scripts/qwen-yesil.sh > "$OTONOM_STATE/son-ci-duzeltme.txt" 2>&1
  git checkout -q -- qwen-rapor.md 2>/dev/null; git clean -qf -- qwen-rapor.md .qwen-verify.txt
  git add -A && git -c user.name="otonom" -c user.email="otonom@planningexpert" commit -qm "Otonom: CI düzeltmesi (tur $tur)" && git push -q
done
# 4 turda yeşil olmadı: PR kapanır, görevler başarısız kaydına düşer, main hiç bozulmaz.
gh pr close "$DAL" -R "$REPO_SLUG" --delete-branch -c "CI 4 turda yeşil olmadı; görevler başarısız olarak kaydedildi." >/dev/null
tasi ci-basarisiz "${ALINAN[@]}"
temizle
exit 1
