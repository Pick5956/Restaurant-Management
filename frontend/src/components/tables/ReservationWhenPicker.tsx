"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ChoiceChips from "@/src/components/shared/ChoiceChips";
import ThemedTimeInput from "@/src/components/shared/ThemedTimeInput";
import {
  addDaysToKey,
  calendarMonthCells,
  chooseReservationDay,
  dateFromKey,
  localDateKey,
  RESERVATION_MAX_DAYS_AHEAD,
  reservationDayBookable,
  type ReservationWhen,
} from "@/src/lib/reservationSchedule";

type Language = "th" | "en";

const COPY = {
  th: {
    when: "เวลา",
    now: "ตอนนี้",
    today: "วันนี้",
    tomorrow: "พรุ่งนี้",
    pickDate: "เลือกวัน",
    previousMonth: "เดือนก่อน",
    nextMonth: "เดือนถัดไป",
    arrivalTime: "เวลาที่ลูกค้าจะมา",
    weekdays: ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"],
  },
  en: {
    when: "Time",
    now: "Now",
    today: "Today",
    tomorrow: "Tomorrow",
    pickDate: "Pick date",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    arrivalTime: "Arrival time",
    weekdays: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  },
} as const;

const localeOf = (language: Language) => (language === "th" ? "th-TH" : "en-US");

interface ReservationWhenPickerProps {
  value: ReservationWhen;
  onChange: (next: ReservationWhen) => void;
  /** Unused since the time became ThemedTimeInput, which only yields real times. */
  onInvalidTime?: () => void;
  /**
   * Why the chosen time cannot be booked. Shown under the time field, not in the
   * sheet's banner: on a phone the banner is scrolled out of sight by the time
   * anyone reaches the time, and a time that snaps back with no reason looks broken.
   */
  error?: string;
  language: Language;
  disabled?: boolean;
}

/**
 * When the guests are coming: now, today, tomorrow or any day up to a year out,
 * at any minute. The day is our own calendar rather than a native date input -
 * the Thai native date picker renders "4 Aug BE 2569". The time is the same
 * ThemedTimeInput the promotions dialog uses.
 */
export default function ReservationWhenPicker({ value, onChange, error, language, disabled }: ReservationWhenPickerProps) {
  const copy = COPY[language];

  return (
    <div>
      <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.when}</span>
      {/* The day chips and the time field are the promotions dialog's own
          (owner, 2026-09-22): ChoiceChips and ThemedTimeInput. */}
      <ChoiceChips
        label={copy.when}
        value={value.choice}
        disabled={disabled}
        onChange={(choice) => onChange(chooseReservationDay(value, choice, new Date()))}
        options={[
          { value: "now", label: copy.now },
          { value: "today", label: copy.today },
          { value: "tomorrow", label: copy.tomorrow },
          { value: "date", label: copy.pickDate },
        ]}
      />
      {value.choice === "date" ? (
        <ReservationCalendar
          selected={value.date}
          language={language}
          disabled={disabled}
          onSelect={(date) => onChange({ ...value, date })}
        />
      ) : null}
      {value.choice !== "now" ? (
        <>
          <div className="mt-2.5">
            <ThemedTimeInput
              value={value.time}
              onChange={(time) => onChange({ ...value, time })}
              disabled={disabled}
              placement="above"
              aria-label={copy.arrivalTime}
            />
          </div>
          {error ? (
            <p role="alert" className="mt-1.5 text-[12px] font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ReservationCalendar({
  selected,
  onSelect,
  language,
  disabled,
}: {
  selected: string;
  onSelect: (date: string) => void;
  language: Language;
  disabled?: boolean;
}) {
  const copy = COPY[language];
  const now = new Date();
  const todayKey = localDateKey(now);
  const first = dateFromKey(todayKey) ?? now;
  const last = dateFromKey(addDaysToKey(todayKey, RESERVATION_MAX_DAYS_AHEAD)) ?? now;
  const opening = dateFromKey(selected) ?? first;
  const [view, setView] = useState({ year: opening.getFullYear(), month: opening.getMonth() });
  const [focusKey, setFocusKey] = useState(selected);
  const focusPending = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const cells = useMemo(() => calendarMonthCells(view.year, view.month), [view]);
  const monthTitle = new Intl.DateTimeFormat(localeOf(language), { month: "long", year: "numeric" }).format(new Date(view.year, view.month, 1));
  const dayName = new Intl.DateTimeFormat(localeOf(language), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const monthIndex = (date: Date) => date.getFullYear() * 12 + date.getMonth();
  const viewIndex = view.year * 12 + view.month;
  // One tab stop for the whole grid; the arrow keys walk it from there.
  const tabbableKey = cells.includes(focusKey) && reservationDayBookable(focusKey, now)
    ? focusKey
    : cells.find((key): key is string => key !== null && reservationDayBookable(key, now)) ?? null;

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusKey}"]`)?.focus();
  }, [focusKey, view]);

  const showMonth = (offset: number) => {
    const target = new Date(view.year, view.month + offset, 1);
    setView({ year: target.getFullYear(), month: target.getMonth() });
  };

  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key];
    const from = (event.target as HTMLElement).dataset.date;
    if (!step || !from) return;
    event.preventDefault();
    const next = addDaysToKey(from, step);
    const nextDate = dateFromKey(next);
    if (!nextDate || !reservationDayBookable(next, new Date())) return;
    focusPending.current = true;
    setFocusKey(next);
    setView({ year: nextDate.getFullYear(), month: nextDate.getMonth() });
  };

  return (
    <div className="mt-2 rounded-md border border-gray-200 p-2 dark:border-gray-700">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => showMonth(-1)}
          disabled={disabled || viewIndex <= monthIndex(first)}
          aria-label={copy.previousMonth}
          className="ui-press inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-700 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-orange-500/60 disabled:opacity-30 dark:text-gray-200 dark:hover:bg-gray-800 sm:h-9 sm:w-9"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <p className="text-[14px] font-semibold text-gray-900 dark:text-white" aria-live="polite">
          {monthTitle}
        </p>
        <button
          type="button"
          onClick={() => showMonth(1)}
          disabled={disabled || viewIndex >= monthIndex(last)}
          aria-label={copy.nextMonth}
          className="ui-press inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-700 outline-none hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-orange-500/60 disabled:opacity-30 dark:text-gray-200 dark:hover:bg-gray-800 sm:h-9 sm:w-9"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1 grid grid-cols-7 text-center text-[11px] font-medium text-gray-500 dark:text-gray-400" aria-hidden="true">
        {copy.weekdays.map((weekday) => (
          <span key={weekday} className="py-1">
            {weekday}
          </span>
        ))}
      </div>
      <div ref={gridRef} role="group" aria-label={monthTitle} onKeyDown={walk} className="grid grid-cols-7 gap-1">
        {cells.map((key, index) => {
          if (!key) return <span key={`pad-${index}`} aria-hidden="true" />;
          const date = dateFromKey(key);
          if (!date) return <span key={key} aria-hidden="true" />;
          const bookable = reservationDayBookable(key, now);
          const isSelected = key === selected;
          const isToday = key === todayKey;
          const tone = isSelected
            ? "bg-gray-900 font-semibold text-white dark:bg-white dark:text-gray-900"
            : !bookable
              ? "text-gray-300 dark:text-gray-600"
              : isToday
                ? "font-semibold text-gray-950 hover:bg-gray-100 dark:text-white dark:hover:bg-gray-800"
                : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800";
          return (
            <button
              key={key}
              type="button"
              data-date={key}
              tabIndex={key === tabbableKey ? 0 : -1}
              disabled={disabled || !bookable}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              aria-label={dayName.format(date)}
              onClick={() => {
                setFocusKey(key);
                onSelect(key);
              }}
              className={`ui-press relative h-11 rounded-md text-[15px] tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-orange-500/60 disabled:cursor-not-allowed sm:h-9 sm:text-[13px] ${tone}`}
            >
              {date.getDate()}
              {isToday ? (
                <span
                  aria-hidden="true"
                  className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${isSelected ? "bg-orange-400 dark:bg-orange-600" : "bg-orange-600 dark:bg-orange-400"}`}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

