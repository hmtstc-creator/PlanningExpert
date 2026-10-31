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

# Görevi Claude yazar (kullanıcı kararı 2026-10-31: Gemini / Qwen kaldırıldı). En küçük modelden
# başlar, verify kırmızıysa ya da korunan dosyaya dokunduysa bir üst modelle baştan dener:
# haiku → sonnet → opus. Her deneme o anki HEAD'den başlar (görev dalı ya da yayın dalı).
# $1 görev metni. Sonuç: değişiklikler çalışma kopyasında; yazan model $OTONOM_STATE/son-model.
KORUNAN_RE='planPipeline|scheduler|planValidator|src/lib/planning\.ts|oee|rawMrp|rawLeadTime|convex/schema\.ts|convex/otonom\.ts|planlogic|package(-lock)?\.json|tsconfig|vite\.config|^deploy/|^scripts/|^\.github/|^docs/|CLAUDE\.md|^\.claude/'
claude_yaz() {
  local gorev=$1 m
  for m in haiku sonnet opus; do
    git checkout -q -- . && git clean -qfd -e node_modules
    { cat scripts/otonom/kod-prompt.md; echo; echo "## Görev"; echo "$gorev"; } |
      timeout 1500 claude -p --model "$m" --max-turns 40 --permission-mode acceptEdits \
        --allowedTools "Read,Edit,Write,Glob,Grep,Bash(npm run verify),Bash(npx vitest run *),Bash(git diff *),Bash(git status)" \
        --disallowedTools "WebFetch,WebSearch,Agent" > "$OTONOM_STATE/son-kod-$m.txt" 2>&1
    git add -A
    if [ -n "$(git diff --cached --name-only --diff-filter=DR)" ] || git diff --cached --name-only | grep -Eq "$KORUNAN_RE"; then
      log "  $m: korunan dosya / silme — sonraki model"; git reset -q; continue
    fi
    git reset -q
    if git diff --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then log "  $m: değişiklik yok"; continue; fi
    if npm run verify > "$OTONOM_STATE/son-verify.txt" 2>&1; then echo "$m" > "$OTONOM_STATE/son-model"; log "  $m: verify yeşil"; return 0; fi
    log "  $m: verify kırmızı — sonraki model"
  done
  git checkout -q -- . && git clean -qfd -e node_modules
  return 1
}

mkdir -p "$KUYRUK" "$HAZIR" "$BITEN" 2>/dev/null || true
