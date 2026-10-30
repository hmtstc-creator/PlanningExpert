# Qwen verify raporu

Model: `nvidia/nemotron-3-ultra-550b-a55b:free` · Dal: `claude/nut-welding-bagi-ara-mamul-78dz6s` · 2026-10-30 20:35 UTC

**Görev modu.** Görev:

> Only edit src/components/plan/PlanChecks.tsx. `RuleCheck` (src/lib/planValidator.ts) now has an optional `advisory?: boolean` flag and `ValidationSummary` has an optional `componentShort?: number` (count of jobs whose intermediate part is not ready; rule id 'component-ready'). Advisory rules are warnings, not broken rules. Change three things in `IndependentCheck`: (1) in the rule list (`v.rules.map`), when `r.advisory && r.broken > 0` show an amber '⚠' (className 'text-amber-600') instead of the red '✗', write `${r.broken} warnings` instead of `${r.broken} broken`, and render its examples list with 'text-amber-700' instead of 'text-destructive'; non-advisory rules stay exactly as now. (2) Add one more `CheckStat` right after the "Rules broken" one: `<CheckStat label="Intermediate part not ready (warning)" value={sm.componentShort ?? 0} warn={(sm.componentShort ?? 0) > 0} hint="nut welding ← stamped part; the engine does not plan this link" />`. (3) Nothing else changes; the box colour still depends only on rulesOk and engineOk. Acceptance: `npm run verify` green, no other file changed. 

Başlangıç: verify kırmızı, 0 hata satırı.

- Bu turu yazan model: `gemini-2.5-flash`
- Tur 1: **verify yeşil**.

## Sonuç: yeşil — Claude'un onayı bekleniyor

1 dosya, 30 satır değişti:
```
 src/components/plan/PlanChecks.tsx | 30 ++++++++++++++++++++++++++----
 1 file changed, 26 insertions(+), 4 deletions(-)
```

Değişiklikler **çalışma dalına girmedi**. Ayrı bir dala (`qwen/<dal>`) itildi;
çalışma dalına almadan önce Claude okuyup karar verir.

Tam fark:
```diff
diff --git a/src/components/plan/PlanChecks.tsx b/src/components/plan/PlanChecks.tsx
index 60e703a..790229e 100644
--- a/src/components/plan/PlanChecks.tsx
+++ b/src/components/plan/PlanChecks.tsx
@@ -65,6 +65,12 @@ export function IndependentCheck({ v }: { v: PlanValidation }) {
           warn={!engineOk}
         />
         <CheckStat label="Rules broken" value={sm.rulesBroken} warn={!rulesOk} hint={sm.rulesFailed.join(', ') || 'none'} />
+        <CheckStat
+          label="Intermediate part not ready (warning)"
+          value={sm.componentShort ?? 0}
+          warn={(sm.componentShort ?? 0) > 0}
+          hint="nut welding ← stamped part; the engine does not plan this link"
+        />
         <CheckStat label="Setups (plan / minimum)" value={`${sm.setups.plan} / ${sm.setups.lowerBound}`} />
         <CheckStat label="Production time (plan / max possible)" value={`${sm.utilisation.plan}% / ${sm.utilisation.upperBound}%`} />
         <CheckStat
@@ -131,15 +137,31 @@ export function IndependentCheck({ v }: { v: PlanValidation }) {
           <ul className="grid gap-1 text-sm sm:grid-cols-2">
             {v.rules.map((r) => (
               <li key={r.id}>
-                <span className={r.broken === 0 ? 'text-emerald-700' : 'text-destructive'}>
-                  {r.broken === 0 ? '✓' : '✗'}
+                <span
+                  className={
+                    r.broken === 0
+                      ? 'text-emerald-700'
+                      : r.advisory && r.broken > 0
+                        ? 'text-amber-600'
+                        : 'text-destructive'
+                  }
+                >
+                  {r.broken === 0 ? '✓' : r.advisory && r.broken > 0 ? '⚠' : '✗'}
                 </span>{' '}
                 <span className="text-foreground">{r.label}</span>{' '}
                 <span className="text-xs text-muted-foreground">
-                  ({r.checked.toLocaleString('en-GB')} checked{r.broken > 0 ? `, ${r.broken} broken` : ''})
+                  ({r.checked.toLocaleString('en-GB')} checked
+                  {r.broken > 0
+                    ? `, ${r.broken} ${r.advisory ? 'warnings' : 'broken'}`
+                    : ''}
+                  )
                 </span>
                 {r.examples.length > 0 && r.broken > 0 && (
-                  <ul className="ml-5 list-disc text-xs text-destructive">
+                  <ul
+                    className={`ml-5 list-disc text-xs ${
+                      r.advisory ? 'text-amber-700' : 'text-destructive'
+                    }`}
+                  >
                     {r.examples.slice(0, 5).map((x) => (
                       <li key={x}>{x}</li>
                     ))}
```
