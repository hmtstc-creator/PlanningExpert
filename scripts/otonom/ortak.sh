#!/usr/bin/env bash
# Otonom geliştirme döngüsünün ortak ayarları (wiki 13). Her betik ilk iş bunu okur.
# Kapalıyken (DURDUR dosyası varsa ya da kurulum eksikse) hiçbir şey yapmadan çıkar.
set -uo pipefail

OTONOM_ETC=/etc/otonom
OTONOM_STATE=/var/lib/otonom
OTONOM_REPO=/home/otonom/PlanningExpert
KUYRUK=$OTONOM_STATE/kuyruk      # bekleyen görevler (toplantı yazar)
HAZIR=$OTONOM_STATE/hazir        # testi + onayı geçen görevler (patch)
BITEN=$OTONOM_STATE/biten        # yayınlanan / başarısız görevler
REPO_SLUG=hmtstc-creator/PlanningExpert

log() { echo "[$(date '+%F %T')] $*"; }

otonom_acik_mi() {
  if [ -e "$OTONOM_ETC/DURDUR" ]; then log "kapalı: $OTONOM_ETC/DURDUR var"; return 1; fi
  if [ ! -f "$OTONOM_ETC/env" ]; then log "kapalı: $OTONOM_ETC/env yok"; return 1; fi
  set -a; . "$OTONOM_ETC/env"; set +a
  command -v claude >/dev/null || { log "kapalı: claude CLI yok"; return 1; }
  command -v gh >/dev/null || { log "kapalı: gh CLI yok"; return 1; }
  gh auth status >/dev/null 2>&1 || { log "kapalı: gh oturumu yok (gh auth login)"; return 1; }
  return 0
}

# Tek seferde tek adım: toplantı, uygulama ve yayın aynı kilidi paylaşır.
kilit_al() {
  exec 8>"$OTONOM_STATE/kilit"
  flock -w "${1:-60}" 8 || { log "başka bir adım sürüyor — çıkılıyor"; exit 0; }
}

# Çalışma kopyasını origin/main'e eşitler (commit'lenmemiş her şey gider).
temizle() {
  git checkout -q -f main && git reset -q --hard origin/main && git clean -qfd -e node_modules
}

# Ana kopyayı origin/main'e eşitler; bağımlılıklar değiştiyse kurar.
repo_esitle() {
  cd "$OTONOM_REPO" || exit 1
  git fetch -q origin main && temizle
  if ! cmp -s package-lock.json node_modules/.otonom-lock 2>/dev/null; then
    npm ci --no-audit --no-fund >/dev/null 2>&1 && cp package-lock.json node_modules/.otonom-lock
  fi
}

# Claude'u araçsız, geçmişsiz çağırır (T8): girdi stdin, çıktı stdout.
claude_sor() { # $1 model
  timeout 600 claude -p --model "$1" --output-format text --max-turns 1 \
    --disallowedTools "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Agent"
}

# Gemini görevi yazar ve verify'ı yeşile çevirir (scripts/qwen-yesil.sh, aynı sınırlar).
# $1 dal (o anki çalışma dalı), $2 görev metni. Sonuç: değişiklikler çalışma kopyasında.
# GEMINI_API_KEY varsa yerelde; yoksa GitHub iş akışında (anahtar orada, sunucuda gizli
# değer gerekmez): dal itilir, qwen-yesil.yml tetiklenir, qwen/<dal> farkı uygulanır.
gemini_yaz() {
  local dal=$1 gorev=$2 run rc
  if [ -n "${GEMINI_API_KEY:-}" ]; then
    QWEN_ONCE=gemini QWEN_TUR=4 QWEN_GOREV="$gorev" timeout 1500 ./scripts/qwen-yesil.sh > "$OTONOM_STATE/son-gemini.txt" 2>&1
    rc=$?
    git checkout -q -- qwen-rapor.md 2>/dev/null; git clean -qf -- qwen-rapor.md .qwen-verify.txt
    return $rc
  fi
  git push -q -f origin "HEAD:refs/heads/$dal" || return 1
  gh api -X POST "repos/$REPO_SLUG/actions/workflows/qwen-yesil.yml/dispatches" \
    -f ref=main -f "inputs[dal]=$dal" -f "inputs[gorev]=$gorev" || return 1
  sleep 20
  run=$(gh run list -R "$REPO_SLUG" -w qwen-yesil.yml -L 5 --json databaseId,displayTitle,createdAt \
    -q "[.[] | select(.displayTitle | contains(\"$dal\"))][0].databaseId // empty")
  [ -n "$run" ] || run=$(gh run list -R "$REPO_SLUG" -w qwen-yesil.yml -L 1 --json databaseId -q '.[0].databaseId')
  timeout 1800 gh run watch "$run" -R "$REPO_SLUG" --exit-status > "$OTONOM_STATE/son-gemini.txt" 2>&1
  rc=$?
  if git fetch -q origin "qwen/$dal" 2>/dev/null; then
    git diff HEAD FETCH_HEAD -- . ':!qwen-rapor.md' | git apply --index || rc=1
    git push -q origin --delete "qwen/$dal" 2>/dev/null
  else
    rc=1
  fi
  return $rc
}

mkdir -p "$KUYRUK" "$HAZIR" "$BITEN" 2>/dev/null || true
