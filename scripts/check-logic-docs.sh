#!/usr/bin/env bash
# Planlama mantığı değiştiyse Planning Logic sayfası da değişmeli (CLAUDE.md →
# "Planning Logic her değişiklikte güncellenir"). PR'da CI çalıştırır:
#   scripts/check-logic-docs.sh [taban-dal]     (varsayılan origin/main)
# Mantık dosyaları değişmişse src/routes/planlogic.tsx de değişmiş olmalı. Mantık
# değişmediyse (yalnız yeniden adlandırma, performans, test) PR gövdesine ya da
# commit mesajına "[logic-docs: n/a] <neden>" yazılır.
set -euo pipefail

base="${1:-origin/main}"
files=$(git diff --name-only "${base}...HEAD" 2>/dev/null || git diff --name-only "${base}" HEAD)

# Motorun, doğrulayıcının ve hammadde hesabının mantığı.
logic='^src/lib/(planPipeline|scheduler|planning|planValidator|rawMrp|rawLeadTime|shiftTimeline|planDiff|oee)\.ts$|^convex/(planEngine|planRuns|planOverrides|planJobLocks|rawLeadTimes)\.ts$'
changed=$(echo "$files" | grep -E "$logic" | grep -v '\.test\.ts$' || true)
[ -z "$changed" ] && { echo "logic-docs: no planning-logic file changed — ok."; exit 0; }

if echo "$files" | grep -qx 'src/routes/planlogic.tsx'; then
  echo "logic-docs: planning logic changed and Planning Logic page updated — ok."
  exit 0
fi

if git log --format=%B "${base}..HEAD" 2>/dev/null | grep -qi '\[logic-docs: n/a\]' || echo "${PR_BODY:-}" | grep -qi '\[logic-docs: n/a\]'; then
  echo "logic-docs: skipped on request ([logic-docs: n/a])."
  exit 0
fi

echo "::error::Planning logic changed but src/routes/planlogic.tsx did not."
echo "Changed logic files:"
echo "$changed" | sed 's/^/  - /'
echo "Update the Planning Logic page (what the change does, in plain words), or add"
echo "'[logic-docs: n/a] <reason>' to a commit message / the PR description."
exit 1
