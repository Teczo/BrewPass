"use client";

export interface HoursWindow {
  day: number;
  open: string;
  close: string;
}

const DAYS = [
  { day: 1, label: "Mon" },
  { day: 2, label: "Tue" },
  { day: 3, label: "Wed" },
  { day: 4, label: "Thu" },
  { day: 5, label: "Fri" },
  { day: 6, label: "Sat" },
  { day: 7, label: "Sun" },
];

/** Per-weekday open/close editor. A day without a window is closed. */
export function OperatingHoursField({
  value,
  onChange,
}: {
  value: HoursWindow[];
  onChange: (next: HoursWindow[]) => void;
}) {
  const byDay = new Map(value.map((win) => [win.day, win]));

  function toggleDay(day: number) {
    if (byDay.has(day)) {
      onChange(value.filter((win) => win.day !== day));
    } else {
      onChange([...value, { day, open: "08:00", close: "18:00" }].sort((a, b) => a.day - b.day));
    }
  }

  function setTime(day: number, field: "open" | "close", time: string) {
    onChange(value.map((win) => (win.day === day ? { ...win, [field]: time } : win)));
  }

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-xs font-medium">Operating hours</legend>
      {DAYS.map(({ day, label }) => {
        const win = byDay.get(day);
        return (
          <div key={day} className="flex items-center gap-2 text-sm">
            <label className="flex w-16 items-center gap-1.5">
              <input type="checkbox" checked={Boolean(win)} onChange={() => toggleDay(day)} />
              {label}
            </label>
            {win ? (
              <>
                <input
                  type="time"
                  value={win.open}
                  onChange={(e) => setTime(day, "open", e.target.value)}
                  className="rounded border border-neutral-300 px-2 py-1 text-sm"
                  required
                />
                <span className="text-neutral-400">–</span>
                <input
                  type="time"
                  value={win.close}
                  onChange={(e) => setTime(day, "close", e.target.value)}
                  className="rounded border border-neutral-300 px-2 py-1 text-sm"
                  required
                />
                {win.open >= win.close && (
                  <span className="text-xs text-red-600">opens after it closes</span>
                )}
              </>
            ) : (
              <span className="text-neutral-400">Closed</span>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
