import { useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { useMutation, useQuery } from "../../lib/convexTransport";
import { serverErrorText } from "../../lib/pressCalendar";
import {
  OPERATOR_SHIFTS_PER_DAY,
  operatorWeekHours,
  shiftHeadcountFromWeekly,
} from "../../lib/operatorCapacity";

interface WeeklyRow {
  costCenter: string;
  weekStart: string;
  operators: number;
}

const dotted = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Operatör planı, uzun vade (Work Calendar → Capacity overview): 'operator'
 * modelli bir cost center için hafta × operatör sayısı. Haftalık sayı o hafta
 * sahadaki kişidir (vardiyalara bölünmez). Kapasite saat olarak =
 * min(makine × 3 × iş günü, haftalık ÷ ortalama ekip × iş günü) × vardiya saati;
 * gün × vardiya girilmemiş günlerde motor vardiya başına floor(haftalık ÷ 3)
 * adam kullanır (src/lib/operatorCapacity.ts).
 */
export function OperatorWeeklyTable({
  costCenter,
  lines,
  weekStarts,
  workingDaysOf,
  shiftMinutes,
}: {
  costCenter: string;
  /** Cost center'ın hatları ve ekip büyüklükleri. */
  lines: { name: string; crewSize?: number }[];
  /** Haftaların Pazartesi'si (ISO, artan). */
  weekStarts: string[];
  /** O haftanın iş günü sayısı (tatiller düşülmüş). */
  workingDaysOf: (weekStart: string) => number;
  /** Vardiya süresi (dakika), Work Calendar'daki vardiya ayarı. */
  shiftMinutes: number;
}) {
  const rows = useQuery(api.operatorWeekly.list) as WeeklyRow[] | undefined;
  const upsert = useMutation(api.operatorWeekly.upsert);
  const remove = useMutation(api.operatorWeekly.remove);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? [])
      if (r.costCenter === costCenter) m.set(r.weekStart, r.operators);
    return m;
  }, [rows, costCenter]);
  const crewSizes = lines.map((l) => l.crewSize);
  const dirty = Object.keys(drafts).length;

  const saveAll = async () => {
    setError(null);
    setBusy(true);
    try {
      for (const [weekStart, text] of Object.entries(drafts)) {
        const before = saved.get(weekStart);
        if (text.trim() === "") {
          if (before !== undefined) await remove({ costCenter, weekStart });
        } else if (Number(text) !== before) {
          await upsert({ costCenter, weekStart, operators: Number(text) });
        }
        setDrafts(({ [weekStart]: _, ...rest }) => rest);
      }
    } catch (e) {
      setError(serverErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Operators per week</h3>
        <span className="text-xs text-muted-foreground">
          {costCenter} · {lines.length} line(s)
        </span>
        <span className="ml-auto flex items-center gap-1">
          {dirty > 0 && (
            <span className="text-xs text-amber-800">{dirty} unsaved</span>
          )}
          <button
            type="button"
            disabled={busy || dirty === 0}
            onClick={() => {
              setDrafts({});
              setError(null);
            }}
            className="rounded-md border border-input px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || dirty === 0}
            onClick={() => void saveAll()}
            className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Save
          </button>
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Operator plan: the machines count as {OPERATOR_SHIFTS_PER_DAY} shifts every
        working day; the people decide how many run. Enter how many operators work
        in the week (not per shift). Capacity = the smaller of machines ×{" "}
        {OPERATOR_SHIFTS_PER_DAY} × working days and operators ÷ average crew ×
        working days. On a day with no per-shift headcount the plan uses operators
        ÷ {OPERATOR_SHIFTS_PER_DAY} (rounded down) per shift. Empty = machines ×{" "}
        {OPERATOR_SHIFTS_PER_DAY} shifts.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr className="bg-muted/60 text-left">
              <th className="border border-border px-2 py-1 font-medium">Week</th>
              <th className="border border-border px-2 py-1 font-medium">Operators</th>
              <th className="border border-border px-2 py-1 font-medium">Per shift</th>
              <th className="border border-border px-2 py-1 font-medium">Machine limit (h)</th>
              <th className="border border-border px-2 py-1 font-medium">Operator limit (h)</th>
              <th className="border border-border px-2 py-1 font-medium">Capacity (h)</th>
            </tr>
          </thead>
          <tbody>
            {weekStarts.map((w) => {
              const text = drafts[w] ?? (saved.has(w) ? String(saved.get(w)) : "");
              const operators = text.trim() === "" ? undefined : Number(text);
              const cap = operatorWeekHours({
                crewSizes,
                workingDays: workingDaysOf(w),
                weeklyOperators: operators,
                shiftMinutes,
              });
              return (
                <tr key={w} className={w in drafts ? "bg-amber-50" : ""}>
                  <td className="border border-border px-2 py-1">Week of {dotted(w)}</td>
                  <td className="border border-border p-0.5">
                    <input
                      aria-label={`Operators week of ${w}`}
                      inputMode="numeric"
                      className="w-20 rounded border border-input bg-background px-1 py-0.5 text-center"
                      placeholder="—"
                      value={text}
                      onChange={(e) =>
                        setDrafts((x) => ({ ...x, [w]: e.target.value.replace(/[^0-9]/g, "") }))
                      }
                    />
                  </td>
                  <td className="border border-border px-2 py-1">
                    {operators === undefined ? "—" : shiftHeadcountFromWeekly(operators)}
                  </td>
                  <td className="border border-border px-2 py-1">{fmt(cap.machineHours)}</td>
                  <td className="border border-border px-2 py-1">
                    {cap.operatorHours === null ? "—" : fmt(cap.operatorHours)}
                  </td>
                  <td className="border border-border px-2 py-1 font-medium">{fmt(cap.hours)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!lines.length && (
        <p className="mt-2 text-xs text-amber-800">
          No work center is linked to this cost center yet.
        </p>
      )}
    </div>
  );
}
