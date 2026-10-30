import { useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { useMutation, useQuery } from "../../lib/convexTransport";
import { maxShiftsPerDay, serverErrorText } from "../../lib/pressCalendar";
import { InfoTip } from "../PageHeader";

interface HeadcountRow {
  costCenter: string;
  date: string;
  shift: number;
  operators: number;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dotted = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/**
 * Operatör planı (Production Plan → Work calendar yanında): 'operator'
 * modelli cost center için gün × vardiya adam sayısı ızgarası ve hatların
 * ekip büyüklüğü. Boş hücre = girilmedi (o vardiyada takvim geçerli). Plan
 * yeniden hesaplanınca adamlar hatlara dağıtılır (src/lib/operatorAllocation.ts).
 */
export function OperatorHeadcountGrid({
  costCenters,
  workCenters,
  dates,
  shiftMinutes,
  editCrew = true,
  className = "mt-4 rounded-lg border border-border p-3 text-sm",
}: {
  /** Planlama modeli 'operator' olan cost center'lar. */
  costCenters: { code: string; name: string }[];
  workCenters: { name: string; costCenter?: string; crewSize?: number }[];
  /** Planın günleri (ISO, artan). */
  dates: string[];
  shiftMinutes?: number;
  /** Hat ekibi burada düzenlensin mi? Plan sayfasında hayır: ekip Work Calendar'da girilir. */
  editCrew?: boolean;
  className?: string;
}) {
  const rows = useQuery(api.operatorHeadcount.list) as
    | HeadcountRow[]
    | undefined;
  const upsert = useMutation(api.operatorHeadcount.upsert);
  const remove = useMutation(api.operatorHeadcount.remove);
  const setCrew = useMutation(api.presses.setCrewSize);
  const [error, setError] = useState<string | null>(null);
  const [cc, setCc] = useState("");
  const [week, setWeek] = useState("");
  /** Kaydedilmemiş hücreler (cc|gün|vardiya → metin) ve ekipler (hat → metin); Save hepsini yazar. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [crewDrafts, setCrewDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const selected = costCenters.some((c) => c.code === cc)
    ? cc
    : (costCenters[0]?.code ?? "");
  const weeks = useMemo(
    () => Array.from(new Set(dates.map(mondayOf))).sort(),
    [dates],
  );
  const monday = weeks.includes(week) ? week : (weeks[0] ?? "");
  const days = monday
    ? Array.from({ length: 7 }, (_, i) => plusDays(monday, i))
    : [];
  const shiftRows = Array.from(
    { length: shiftMinutes ? maxShiftsPerDay(shiftMinutes) : 3 },
    (_, i) => i + 1,
  );
  const valueOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? [])
      m.set(`${r.costCenter}|${r.date}|${r.shift}`, r.operators);
    return m;
  }, [rows]);
  const lines = workCenters
    .filter((w) => w.costCenter === selected)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (costCenters.length === 0) return null;

  const dirty = Object.keys(drafts).length + Object.keys(crewDrafts).length;
  /** Bütün taslakları yazar; hata olursa kalan taslak ekranda kalır. */
  const saveAll = async () => {
    setError(null);
    setBusy(true);
    try {
      for (const [key, text] of Object.entries(drafts)) {
        const [costCenter, date, shiftText] = key.split("|");
        const shift = Number(shiftText);
        const before = valueOf.get(key);
        if (text.trim() === "") {
          if (before !== undefined) await remove({ costCenter, date, shift });
        } else if (Number(text) !== before) {
          await upsert({ costCenter, date, shift, operators: Number(text) });
        }
        setDrafts(({ [key]: _, ...rest }) => rest);
      }
      for (const [name, text] of Object.entries(crewDrafts)) {
        const n = Number(text);
        await setCrew({ name, crewSize: text.trim() === "" ? null : n });
        setCrewDrafts(({ [name]: _, ...rest }) => rest);
      }
    } catch (e) {
      setError(serverErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  const discard = () => {
    setDrafts({});
    setCrewDrafts({});
    setError(null);
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Operators per shift</h3>
        <InfoTip label="About the operator plan">
          <p>
            Operator plan: enter how many operators work each shift and press Save. When the plan
            is recalculated they go to the lines with the earliest due work (crew
            size permitting); a line with no work left this week gets none. An
            empty cell keeps the Work Calendar; a day set by hand on the work
            calendar always wins.
          </p>
          {!editCrew && (
            <p>Crew (people one line needs to run) is set on the Work Calendar → Capacity overview.</p>
          )}
        </InfoTip>
        {costCenters.length > 1 ? (
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            value={selected}
            onChange={(e) => setCc(e.target.value)}
          >
            {costCenters.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} {c.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-muted-foreground">
            {costCenters[0].code} {costCenters[0].name}
          </span>
        )}
        <select
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          value={monday}
          onChange={(e) => setWeek(e.target.value)}
        >
          {weeks.map((w) => (
            <option key={w} value={w}>
              Week of {dotted(w)}
            </option>
          ))}
        </select>
        <span className="ml-auto flex items-center gap-1">
          {dirty > 0 && (
            <span className="text-xs text-amber-800">{dirty} unsaved</span>
          )}
          <button
            type="button"
            disabled={busy || dirty === 0}
            onClick={discard}
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
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {monday === "" ? (
        <p className="mt-3 text-xs text-muted-foreground">No plan yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-center text-xs">
            <thead>
              <tr>
                <th className="w-12" />
                {days.map((d, i) => (
                  <th
                    key={d}
                    className="border border-border bg-muted/60 px-1 py-1 font-medium"
                  >
                    {WEEKDAYS[i]} {dotted(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shiftRows.map((s) => (
                <tr key={s}>
                  <th className="border border-border bg-muted/60 font-medium">
                    Shift {s}
                  </th>
                  {days.map((d) => {
                    const key = `${selected}|${d}|${s}`;
                    const saved = valueOf.get(key);
                    return (
                      <td key={d} className={`border border-border p-0.5 ${key in drafts ? "bg-amber-50" : ""}`}>
                        <input
                          aria-label={`Operators ${d} shift ${s}`}
                          inputMode="numeric"
                          className="w-full rounded border border-input bg-background px-1 py-0.5 text-center tabular-nums"
                          placeholder="—"
                          value={drafts[key] ?? (saved === undefined ? "" : String(saved))}
                          onChange={(e) =>
                            setDrafts((x) => ({ ...x, [key]: e.target.value.replace(/[^0-9]/g, "") }))
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editCrew && (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Crew per line:</span>
        {lines.map((l) => (
          <label key={l.name} className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5">
            {l.name}
            <input
              aria-label={`Crew size ${l.name}`}
              inputMode="numeric"
              className="w-10 rounded border border-input bg-background px-1 text-center tabular-nums"
              value={crewDrafts[l.name] ?? String(l.crewSize ?? 1)}
              onChange={(e) =>
                setCrewDrafts((x) => ({ ...x, [l.name]: e.target.value.replace(/[^0-9]/g, "") }))
              }
            />
          </label>
        ))}
        {!lines.length && (
          <span className="text-amber-800">No work center is linked to this cost center yet.</span>
        )}
      </div>
      )}
    </div>
  );
}
