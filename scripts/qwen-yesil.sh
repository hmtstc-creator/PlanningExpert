#!/usr/bin/env bash
# Qwen'i "npm run verify yeşil olana kadar" döngüsünde çalıştırır.
#
# Amaç token tasarrufu: tip hatası, kırık test, bozuk import gibi MEKANİK
# hataların düzeltme döngüsü burada, ücretsiz bir modelde döner. Claude'a
# yalnız kısa rapor gelir (qwen-rapor.md).
#
# Qwen MİMARİYE DOKUNMAZ. Motor, doğrulayıcı, OEE ve şema dosyaları korunur
# (KORUNAN listesi); bunlara dokunduysa değişiklik itilmez, iş kırmızı biter.
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

# Qwen'in dokunmaması gereken dosyalar: planlama motoru, doğrulayıcı, OEE,
# şema, mimari testleri ve Planning Logic sayfası. Bunlar mimari karar ister;
# yanlış yama, düzeltmesi için daha çok Claude tokeni harcatır.
KORUNAN=(
    "src/lib/planPipeline.ts"
    "src/lib/scheduler.ts"
    "src/lib/planValidator.ts"
    "src/lib/planning.ts"
    "src/lib/oee.ts"
    "src/lib/architecture.test.ts"
    "src/routes/planlogic.tsx"
    "convex/schema.ts"
    "convex/oee.ts"
    "CLAUDE.md"
    "QWEN.md"
    ".github/workflows"
    "scripts/qwen-yesil.sh"
)

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
- NEVER edit these files (they are architecture-critical and protected):
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
DOKUNULAN="$(korunan_degisti)"
if [ -n "$DOKUNULAN" ]; then
    yaz "## Durduruldu: korunan dosyalara dokunuldu"
    yaz ""
    yaz "Qwen şu dosyaları değiştirdi, bu yüzden hiçbir değişiklik itilmedi:"
    yaz '```'
    yaz "$DOKUNULAN"
    yaz '```'
    yaz "Bu dosyalar mimari karar ister; düzeltmeyi Claude yapmalı."
    git checkout -- . 2> /dev/null || true
    exit 2
fi

if [ "$SONUC" -ne 0 ]; then
    yaz "## Sonuç: verify yeşile dönmedi"
    yaz ""
    yaz "Kalan hatalar:"
    yaz '```'
    yaz "$(hatalar | head -25)"
    yaz '```'
    yaz "Qwen'in yaptığı kısmi değişiklikler itilmedi; dal el değmemiş durumda."
    git checkout -- . 2> /dev/null || true
    exit 1
fi

# --------------------------------------------------------------- yeşil
yaz "## Sonuç: yeşil"
yaz ""
yaz "Değişen dosyalar:"
yaz '```'
yaz "$(git diff --stat | tail -20)"
yaz '```'
rm -f "$CIKTI" .qwen-tur-*.txt
exit 0
