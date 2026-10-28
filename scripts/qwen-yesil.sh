#!/usr/bin/env bash
# Qwen'i "npm run verify yeşil olana kadar" döngüsünde çalıştırır.
#
# Amaç token tasarrufu: tip hatası, kırık test, bozuk import gibi MEKANİK
# hataların düzeltme döngüsü burada, ücretsiz bir modelde döner. Claude'a
# yalnız kısa rapor gelir (qwen-rapor.md).
#
# Qwen'in yazdığı hiçbir şey doğrudan çalışma dalına girmez. Düzeltmeler ayrı
# bir dala (qwen/<dal>) itilir; oradan çalışma dalına yalnız Claude alır.
# Kullanıcı kararı 2026-10-28: "kodları başka yapay zeka yazsa da sen final
# kontrolcü ol; başka ajanların neye dokunup dokunamayacağını sen belirle."
#
# Üç katmanlı sınır:
#   1. KORUNAN  — mimari, yapılandırma, belge ve altyapı dosyaları: dokunulursa dur
#   2. SILME    — dosya silme ya da yeniden adlandırma yasak
#   3. BOYUT    — en fazla 10 dosya / 300 satır; aşarsa dur
# Üçünden biri çiğnenirse hiçbir şey itilmez, iş kırmızı biter.
#
# UYARI: koruma adımı `git checkout -- .` ve `git clean -fd` çalıştırır, yani
# çalışma kopyasındaki commit'lenmemiş her şeyi siler. Bu betiği denerken
# ayrı bir worktree kullan, canlı çalışma kopyanda değil.
#
# Gerekli ortam değişkenleri:
#   OPENAI_API_KEY   ücretsiz sağlayıcının anahtarı (GitHub secret)
#   OPENAI_BASE_URL  örn. https://openrouter.ai/api/v1
#   OPENAI_MODEL     örn. qwen/qwen3-coder:free
# İsteğe bağlı:
#   QWEN_TUR         en fazla kaç düzeltme turu (varsayılan 4)

set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 1

TUR_SINIRI="${QWEN_TUR:-4}"
RAPOR="qwen-rapor.md"
CIKTI=".qwen-verify.txt"

KORUNAN=(
    # Planlama motoru ve mimari korumaları
    "src/lib/planPipeline.ts"
    "src/lib/scheduler.ts"
    "src/lib/planValidator.ts"
    "src/lib/planning.ts"
    "src/lib/oee.ts"
    "src/lib/architecture.test.ts"
    "src/routes/planlogic.tsx"
    "convex/schema.ts"
    "convex/oee.ts"
    # Bağımlılıklar ve yapılandırma: bir paket eklemek ya da derleyici ayarını
    # gevşetmek hatayı düzeltmez, saklar.
    "package.json"
    "package-lock.json"
    "tsconfig.json"
    "vite.config.ts"
    "vitest.config.ts"
    # Altyapı ve belge: ajan kendi sınırını ya da yayın akışını değiştiremez.
    ".github"
    "scripts"
    "deploy"
    "docs"
    "CLAUDE.md"
    "QWEN.md"
    ".gitignore"
)

# En fazla bu kadar dosya ve değişen satır; aşarsa düzeltme değil, yeniden
# yazma yapılıyor demektir.
EN_FAZLA_DOSYA=10
EN_FAZLA_SATIR=300

yaz() { printf '%s\n' "$*" >> "$RAPOR"; }

verify_calistir() {
    npm run verify > "$CIKTI" 2>&1
    return $?
}

# Uzun çıktıyı modele olduğu gibi vermeyiz; yalnız hata satırları.
hatalar() {
    grep -E "error TS|FAIL|✗|Error:|✘|Expected|Received" "$CIKTI" | head -60
}

korunan_degisti() {
    local degisen yol
    degisen="$(git diff --name-only; git ls-files --others --exclude-standard)"
    for yol in "${KORUNAN[@]}"; do
        if printf '%s\n' "$degisen" | grep -qx -- "$yol" \
           || printf '%s\n' "$degisen" | grep -q "^$yol/"; then
            echo "$yol"
        fi
    done
}

# --------------------------------------------------------------- hazırlık
: > "$RAPOR"
yaz "# Qwen verify raporu"
yaz ""
yaz "Model: \`${OPENAI_MODEL:-bilinmiyor}\` · Dal: \`$(git rev-parse --abbrev-ref HEAD)\` · $(date -u '+%Y-%m-%d %H:%M UTC')"
yaz ""

if [ -z "${OPENAI_API_KEY:-}" ]; then
    yaz "**Anahtar yok.** \`OPENAI_API_KEY\` deposu gizli değeri tanımlı değil; Qwen çalıştırılamadı."
    exit 1
fi

mkdir -p "$HOME/.qwen"
if [ ! -f "$HOME/.qwen/settings.json" ]; then
    cat > "$HOME/.qwen/settings.json" << 'JSON'
{
  "theme": "Default",
  "selectedAuthType": "openai"
}
JSON
fi

# --------------------------------------------------------------- 0. tur
if verify_calistir; then
    yaz "Verify **zaten yeşil**. Qwen çağrılmadı."
    exit 0
fi

BASLANGIC_HATA="$(hatalar | wc -l)"
yaz "Başlangıç: verify kırmızı, $BASLANGIC_HATA hata satırı."
yaz ""

# --------------------------------------------------------------- döngü
SONUC=1
for TUR in $(seq 1 "$TUR_SINIRI"); do
    echo "=== Qwen turu $TUR/$TUR_SINIRI ==="
    GOREV="$(cat << PROMPT
This is a TypeScript / React / Vite / Convex project. The command \`npm run verify\`
(typecheck + vitest + vite build) is failing. Fix the failures.

Rules you must follow:
- Fix ONLY what is needed to make the build and the existing tests pass.
- Do NOT change behaviour, do NOT redesign, do NOT refactor beyond the fix.
- Do NOT weaken or delete a test to make it pass. Fix the code instead.
- Do NOT delete or rename any file.
- Keep the change small: at most $EN_FAZLA_DOSYA files and $EN_FAZLA_SATIR changed lines.
- NEVER edit these paths (protected; the job is aborted if you do):
  ${KORUNAN[*]}
  If the only possible fix is inside one of them, stop and explain why instead.
- Do not add new dependencies.
- Keep existing code style. Comments and user-facing strings in this repo are Turkish.

Current failures:
$(hatalar)
PROMPT
)"
    qwen --yolo -p "$GOREV" > ".qwen-tur-$TUR.txt" 2>&1
    QWEN_KOD=$?
    if [ "$QWEN_KOD" -ne 0 ]; then
        yaz "- Tur $TUR: Qwen hata verdi (çıkış kodu $QWEN_KOD). Son satırlar:"
        yaz '```'
        yaz "$(tail -15 ".qwen-tur-$TUR.txt")"
        yaz '```'
        break
    fi

    if verify_calistir; then
        yaz "- Tur $TUR: **verify yeşil**."
        SONUC=0
        break
    fi
    yaz "- Tur $TUR: hâlâ kırmızı ($(hatalar | wc -l) hata satırı)."
done

yaz ""

# --------------------------------------------------------------- korumalar
dur() {  # dur BAŞLIK AÇIKLAMA : her şeyi geri al, kırmızı bit
    yaz "## Durduruldu: $1"
    yaz ""
    yaz "$2"
    yaz ""
    yaz "Hiçbir değişiklik itilmedi; dal el değmemiş durumda."
    git checkout -- . 2> /dev/null || true
    git clean -fd 2> /dev/null || true
    exit 2
}

DOKUNULAN="$(korunan_degisti)"
if [ -n "$DOKUNULAN" ]; then
    dur "korunan dosyalara dokunuldu" \
"Qwen şu dosyaları değiştirdi:
\`\`\`
$DOKUNULAN
\`\`\`
Bu dosyalar mimari ya da altyapı kararı ister; düzeltmeyi Claude yapar."
fi

SILINEN="$(git diff --name-only --diff-filter=DR)"
if [ -n "$SILINEN" ]; then
    dur "dosya silindi ya da adı değişti" \
"Qwen'in dosya silmesi ya da yeniden adlandırması yasak:
\`\`\`
$SILINEN
\`\`\`"
fi

DOSYA_SAYISI="$(git diff --name-only | wc -l)"
SATIR_SAYISI="$(git diff --numstat | awk '{e+=$1; s+=$2} END {print e+s+0}')"
if [ "$DOSYA_SAYISI" -gt "$EN_FAZLA_DOSYA" ] || [ "$SATIR_SAYISI" -gt "$EN_FAZLA_SATIR" ]; then
    dur "değişiklik fazla büyük" \
"$DOSYA_SAYISI dosya, $SATIR_SAYISI satır (sınır: $EN_FAZLA_DOSYA dosya, $EN_FAZLA_SATIR satır).
Bu boyut mekanik düzeltme değil, yeniden yazma demektir."
fi

if [ "$SONUC" -ne 0 ]; then
    yaz "## Sonuç: verify yeşile dönmedi"
    yaz ""
    yaz "Kalan hatalar:"
    yaz '```'
    yaz "$(hatalar | head -15)"
    yaz '```'
    yaz "Qwen'in yaptığı kısmi değişiklikler itilmedi; dal el değmemiş durumda."
    git checkout -- . 2> /dev/null || true
    git clean -fd 2> /dev/null || true
    exit 1
fi

# --------------------------------------------------------------- yeşil
yaz "## Sonuç: yeşil — Claude'un onayı bekleniyor"
yaz ""
yaz "$DOSYA_SAYISI dosya, $SATIR_SAYISI satır değişti:"
yaz '```'
yaz "$(git diff --stat | tail -12)"
yaz '```'
yaz ""
DAL="$(git rev-parse --abbrev-ref HEAD)"
yaz "Qwen'in son sözü:"
yaz '```'
yaz "$(tail -8 ".qwen-tur-$TUR.txt" 2> /dev/null)"
yaz '```'
yaz ""
# Tam fark rapora yazılmaz: rapor PR yorumu olarak Claude'un bağlamına girer.
# Claude farkı dalda, önce --stat sonra yalnız şüpheli dosya olarak okur.
yaz "Değişiklikler **çalışma dalına girmedi**; \`qwen/$DAL\` dalında. Claude okuyup karar verir:"
yaz "\`git fetch origin qwen/$DAL && git diff --stat HEAD origin/qwen/$DAL\`"
rm -f "$CIKTI" .qwen-tur-*.txt
exit 0
