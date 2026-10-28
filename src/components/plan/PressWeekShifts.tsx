import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "../../lib/convexTransport";
import { useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { maxShiftsPerDay, serverErrorText } from "../../lib/pressCalendar";
import { activeShiftList } from "../../lib/shiftTimeline";

/** Bir presin bir günü: planın kullandığı normal vardiyalar ve mesai pencereleri. */
export interface PressShiftDay {
  shifts: number;
  /** Çalışan vardiya numaraları; yalnız 1'den art arda değilse (gün kaydı). */
  activeShifts?: number[];
  overtime: { start: number; end: number; name?: string }[];
}

interface OvertimeDefinition {
  _id: string;
  name: string;
  startMinute: number;
  durationMinutes: number;
}
interface PressOvertime {
  _id: string;
  press: string;
  date: string;
  definitionId: string;
}

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const sameList = (a: number[], b: number[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

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
const dotted = (iso: string) =>
  `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const hhmm = (m: number) =>
  `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Production Plan ortadaki kutu (planlamacı 2026-10-28): seçilen iş yerinin
 * haftalık çalışma takvimi — satır vardiya (1–3), sütun gün, üstte gün tarihi.
 * Hücre, planın o gün kullandığı vardiyadır (Work Calendar + istisna hafta +
 * tatil + mesai; tek kaynak `capacityModel`, plan hesabında `run.days`).
 *
 * "Nihai karar ekranı" (slayt 4): *Edit* ile düzenleme kipine girilir; hücre
 * tıklaması o pres × gün × vardiyayı taslakta açar / kapatır, OT satırında o
 * güne mesai eklenir ya da kaldırılır. Hiçbir şey anında yazılmaz; *Save*
 * bütün değişiklikleri birlikte kaydeder (gün kaydı `pressDayShifts` +
 * tarihli mesai), *Cancel* taslağı atar. Plan yeniden hesaplanınca uygulanır;
 * o zamana kadar hücre kesik çizgiyle "bekliyor" gösterilir.
 */
export function PressWeekShifts({
  presses,
  dates,
  dayOf,
  shiftMinutes,
}: {
  presses: { name: string; hall?: string }[];
  /** Planın günleri (ISO, artan). */
  dates: string[];
  dayOf: (press: string, date: string) => PressShiftDay | undefined;
  /** Vardiya süresi (dk): günde kaç vardiya satırı gösterileceği. */
  shiftMinutes?: number;
}) {
  const records = useQuery(api.dayShifts.list) as
    | { press: string; date: string; shifts: number[] }[]
    | undefined;
  const definitions = (useQuery(api.overtime.listDefinitions) ??
    []) as OvertimeDefinition[];
  const pressOvertime = (useQuery(api.overtime.listPressOvertime) ??
    []) as PressOvertime[];
  const setDay = useMutation(api.dayShifts.setDay);
  const addOvertime = useMutation(api.overtime.addPressOvertime);
  const removeOvertime = useMutation(api.overtime.removePressOvertime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  /** Kaydedilmemiş vardiya taslağı: gün → vardiyalar, `null` = şablona dön. */
  const [draft, setDraft] = useState<Record<string, number[] | null>>({});
  /** Kaydedilmemiş mesai taslağı: eklenecekler ve kaldırılacak kayıt kimlikleri. */
  const [otAdd, setOtAdd] = useState<{ date: string; definitionId: string }[]>(
    [],
  );
  const [otDrop, setOtDrop] = useState<string[]>([]);
  const recordOf = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of records ?? [])
      m.set(
        `${r.press}|${r.date}`,
        [...r.shifts].sort((a, b) => a - b),
      );
    return m;
  }, [records]);
  const defOf = useMemo(
    () => new Map(definitions.map((d) => [d._id, d])),
    [definitions],
  );
  const shiftRows = useMemo(
    () =>
      Array.from(
        { length: shiftMinutes ? maxShiftsPerDay(shiftMinutes) : 3 },
        (_, i) => i + 1,
      ),
    [shiftMinutes],
  );
  const names = useMemo(() => presses.map((p) => p.name).sort(), [presses]);
  const weeks = useMemo(
    () => Array.from(new Set(dates.map(mondayOf))).sort(),
    [dates],
  );
  const [press, setPress] = useState("");
  const [week, setWeek] = useState("");
  const selected = names.includes(press) ? press : (names[0] ?? "");
  const monday = weeks.includes(week) ? week : (weeks[0] ?? "");
  const days = monday ? WEEKDAYS.map((_, i) => plusDays(monday, i)) : [];
  const inPlan = new Set(dates);
  const dirty =
    Object.keys(draft).length > 0 || otAdd.length > 0 || otDrop.length > 0;
  const reset = () => {
    setDraft({});
    setOtAdd([]);
    setOtDrop([]);
    setError(null);
  };
  /** İş yeri ya da hafta değişince taslak karışmasın. */
  const leaveEdit = () => {
    reset();
    setEditing(false);
  };
  /** Planın o gün kullandığı vardiyalar (plan hesabı). */
  const plannedOf = (d: string) => {
    const day = dayOf(selected, d);
    return day ? activeShiftList(day) : [];
  };
  /** Gösterilen vardiyalar: taslak > gün kaydı (plan henüz görmemiş olabilir) > plan. */
  const shownOf = (d: string) => {
    if (d in draft) return draft[d] ?? plannedOf(d);
    return recordOf.get(`${selected}|${d}`) ?? plannedOf(d);
  };
  /** O günün kaydedilmiş tarihli mesaileri (taslakta kaldırılanlar düşülür). */
  const datedOvertime = (d: string) =>
    pressOvertime.filter(
      (o) => o.press === selected && o.date === d && !otDrop.includes(o._id),
    );
  const toggle = (d: string, s: number) => {
    const now = shownOf(d);
    const next = now.includes(s)
      ? now.filter((x) => x !== s)
      : [...now, s].sort((a, b) => a - b);
    setDraft((prev) => ({ ...prev, [d]: next }));
  };
  /** Günü şablona döndür: kaydedilmiş gün kaydı silinecek. */
  const revert = (d: string) => setDraft((prev) => ({ ...prev, [d]: null }));

  /**
   * Taslağı sırayla uygular: önce mesai kaldırma, sonra gün kaydı, en sonda
   * mesai ekleme — sunucu açılan vardiyayla çakışan mesaiyi reddettiği için
   * bu sıra en az takılır. Başarılı adım taslaktan düşer; hata olunca kalan
   * taslakla düzenleme kipinde kalınır.
   */
  const save = async () => {
    setBusy(true);
    setError(null);
    const dropped: string[] = [];
    const added: { date: string; definitionId: string }[] = [];
    const saved: string[] = [];
    try {
      for (const id of otDrop) {
        await removeOvertime({ id });
        dropped.push(id);
      }
      for (const [date, shifts] of Object.entries(draft)) {
        await setDay({ press: selected, date, shifts });
        saved.push(date);
      }
      for (const a of otAdd) {
        await addOvertime({
          press: selected,
          date: a.date,
          definitionId: a.definitionId,
        });
        added.push(a);
      }
      reset();
      setEditing(false);
    } catch (e) {
      setError(serverErrorText(e));
      setOtDrop((prev) => prev.filter((id) => !dropped.includes(id)));
      setDraft((prev) =>
        Object.fromEntries(
          Object.entries(prev).filter(([d]) => !saved.includes(d)),
        ),
      );
      setOtAdd((prev) =>
        prev.filter(
          (a) =>
            !added.some(
              (x) => x.date === a.date && x.definitionId === a.definitionId,
            ),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-foreground">Work calendar</span>
        <select
          aria-label="Work center"
          value={selected}
          onChange={(e) => {
            leaveEdit();
            setPress(e.target.value);
          }}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {weeks.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => {
                leaveEdit();
                setWeek(w);
              }}
              className={`rounded-md px-2 py-1 text-xs font-medium ${w === monday ? "bg-foreground text-background" : "border border-input hover:bg-muted"}`}
            >
              {dotted(w).slice(0, 5)}
            </button>
          ))}
        </div>
        {selected !== "" &&
          (editing ? (
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                disabled={busy || !dirty}
                onClick={() => void save()}
                className="rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={leaveEdit}
                className="rounded-md border border-input px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ml-auto rounded-md border border-input px-2 py-1 text-xs font-medium hover:bg-muted"
            >
              Edit
            </button>
          ))}
        <Link
          to="/takvim"
          className={`text-xs text-muted-foreground underline hover:text-foreground ${editing || selected === "" ? "ml-auto" : ""}`}
        >
          Edit on Work Calendar →
        </Link>
      </div>
      {selected === "" ? (
        <p className="mt-3 text-xs text-muted-foreground">No plan yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-center text-xs">
            <thead>
              <tr>
                <th className="w-8" />
                {days.map((d) => {
                  const byHand = recordOf.has(`${selected}|${d}`) || d in draft;
                  return (
                    <th
                      key={d}
                      className="px-1 pb-0.5 font-medium text-purple-700 dark:text-purple-300"
                    >
                      {dotted(d).slice(0, 5)}
                      {byHand &&
                        (editing ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => revert(d)}
                            title="Set by hand on this screen — click to go back to the Work Calendar pattern"
                            className="ml-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            ↺
                          </button>
                        ) : (
                          <span
                            className="ml-0.5 text-muted-foreground"
                            title="Set by hand on this screen"
                          >
                            ↺
                          </span>
                        ))}
                    </th>
                  );
                })}
              </tr>
              <tr>
                <th className="w-8" />
                {WEEKDAYS.map((w) => (
                  <th
                    key={w}
                    className="border border-border bg-muted/60 px-1 py-1 font-medium text-foreground"
                  >
                    <span className="hidden xl:inline">{w}</span>
                    <span className="xl:hidden">{w.slice(0, 3)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shiftRows.map((s) => (
                <tr key={s}>
                  <th className="border border-border bg-muted/60 font-medium text-foreground">
                    {s}
                  </th>
                  {days.map((d) => {
                    if (!inPlan.has(d)) {
                      return (
                        <td
                          key={d}
                          title="Outside the plan"
                          className="h-7 border border-border bg-muted/40"
                        />
                      );
                    }
                    const shown = shownOf(d);
                    const works = shown.includes(s);
                    // Plana henüz girmedi (kayıt ya da taslak): yeniden hesaplanınca uygulanır.
                    const pending = !sameList(shown, plannedOf(d));
                    const state = `${selected} ${dotted(d)} shift ${s}: ${works ? "working" : "not working"}${pending ? " (applies when the plan is recalculated)" : ""}`;
                    const look = `${works ? "bg-emerald-200 dark:bg-emerald-900" : "bg-background"} ${pending ? "outline-dashed outline-2 -outline-offset-2 outline-amber-500" : ""}`;
                    return (
                      <td key={d} className="h-7 border border-border p-0">
                        {editing ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => toggle(d, s)}
                            title={`${state} — click to ${works ? "close" : "open"}`}
                            className={`h-full w-full disabled:cursor-wait ${look} ${works ? "hover:bg-emerald-300 dark:hover:bg-emerald-800" : "hover:bg-muted"}`}
                          >
                            {works ? "✓" : ""}
                          </button>
                        ) : (
                          <div
                            title={state}
                            className={`flex h-full w-full items-center justify-center ${look}`}
                          >
                            {works ? "✓" : ""}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th
                  className="border border-border bg-muted/60 font-medium text-foreground"
                  title="Overtime"
                >
                  OT
                </th>
                {days.map((d) => {
                  if (editing) {
                    const dated = datedOvertime(d);
                    const planned = otAdd.filter((a) => a.date === d);
                    return (
                      <td
                        key={d}
                        className="h-7 border border-border p-0.5 align-top text-[10px]"
                      >
                        {inPlan.has(d) ? (
                          <div className="flex flex-col gap-0.5">
                            {dated.map((o) => (
                              <button
                                key={o._id}
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  setOtDrop((prev) => [...prev, o._id])
                                }
                                title={`${defOf.get(o.definitionId)?.name ?? "Overtime"} on ${dotted(d)} for ${selected} — click to remove`}
                                className="rounded bg-amber-100 px-1 text-amber-900 hover:line-through disabled:opacity-50 dark:bg-amber-950 dark:text-amber-100"
                              >
                                {defOf.get(o.definitionId)?.name ?? "Overtime"}{" "}
                                ✕
                              </button>
                            ))}
                            {planned.map((a, i) => (
                              <button
                                key={`${a.definitionId}-${i}`}
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  setOtAdd((prev) =>
                                    prev.filter((x) => x !== a),
                                  )
                                }
                                title={`${defOf.get(a.definitionId)?.name ?? "Overtime"} on ${dotted(d)} for ${selected} — not saved yet, click to drop`}
                                className="rounded bg-amber-100 px-1 text-amber-900 outline-dashed outline-1 outline-amber-500 hover:line-through disabled:opacity-50 dark:bg-amber-950 dark:text-amber-100"
                              >
                                {defOf.get(a.definitionId)?.name ?? "Overtime"}{" "}
                                ✕
                              </button>
                            ))}
                            <select
                              aria-label={`Add overtime on ${dotted(d)}`}
                              value=""
                              disabled={busy || definitions.length === 0}
                              onChange={(e) => {
                                if (e.target.value)
                                  setOtAdd((prev) => [
                                    ...prev,
                                    { date: d, definitionId: e.target.value },
                                  ]);
                              }}
                              className="w-full rounded border border-input bg-background text-[10px]"
                            >
                              <option value="">+ overtime</option>
                              {definitions.map((def) => (
                                <option key={def._id} value={def._id}>
                                  {def.name} {hhmm(def.startMinute)}–
                                  {hhmm(def.startMinute + def.durationMinutes)}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                      </td>
                    );
                  }
                  const ot = inPlan.has(d)
                    ? (dayOf(selected, d)?.overtime ?? [])
                    : [];
                  return (
                    <td
                      key={d}
                      className={`h-7 border border-border text-[10px] ${ot.length ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100" : ""}`}
                    >
                      {ot
                        .map((o) => `${hhmm(o.start)}–${hhmm(o.end)}`)
                        .join(" ")}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {editing ? (
              <>
                Click a cell to open or close that shift for this work center
                and day (↺ goes back to the pattern); on the OT row add or
                remove overtime for that day. Nothing is written until you press
                Save. A dashed cell is not in the plan yet — press Calculate
                plan after saving.
              </>
            ) : (
              <>
                Press Edit to open or close shifts and organize overtime for
                this work center. A dashed cell is not in the plan yet — press
                Calculate plan.
              </>
            )}
          </p>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
