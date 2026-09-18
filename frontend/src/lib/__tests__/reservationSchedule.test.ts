import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  calendarMonthCells,
  chooseReservationDay,
  dateFromKey,
  formatReservationClock,
  initialReservationWhen,
  isCompleteReservationTime,
  localDateKey,
  nudgeReservationTime,
  parseReservationTime,
  reservationClock,
  reservationDayBookable,
  reservationInstantFor,
  reservationReminder,
  reservationTimeDraft,
  reservationWhenProblem,
  stepReservationTime,
  type ReservationWhen,
} from "../reservationSchedule";

// The web POS books any day up to a year ahead at any minute. The app still
// offers quarter-hour slots for today and tomorrow; both send one instant, so
// nothing here has to match the app's slot list.

describe("date keys", () => {
  it("names the local calendar day, whatever the clock says", () => {
    expect(localDateKey(new Date(2026, 8, 9, 23, 59))).toBe("2026-09-09");
    expect(localDateKey(new Date(2026, 0, 5, 0, 0))).toBe("2026-01-05");
  });

  it("refuses a key that is not a real day instead of rolling it over", () => {
    expect(dateFromKey("2026-02-30")).toBeNull();
    expect(dateFromKey("not a day")).toBeNull();
    expect(dateFromKey("2026-09-09")?.getDate()).toBe(9);
  });

  it("adds days across month and year ends", () => {
    expect(addDaysToKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("typing a time", () => {
  it("puts the colon in as the digits arrive", () => {
    expect(reservationTimeDraft("2")).toBe("2");
    expect(reservationTimeDraft("20")).toBe("20");
    expect(reservationTimeDraft("202")).toBe("20:2");
    expect(reservationTimeDraft("2021")).toBe("20:21");
    expect(reservationTimeDraft("20215")).toBe("20:21");
  });

  it("reads an hour from 3 upward as one digit, so 930 is half past nine", () => {
    expect(reservationTimeDraft("930")).toBe("9:30");
    expect(reservationTimeDraft("9305")).toBe("9:30");
  });

  it("drops separators people type out of habit", () => {
    expect(reservationTimeDraft("20:21")).toBe("20:21");
    expect(reservationTimeDraft("20.21")).toBe("20:21");
  });

  it("knows when a typed time is complete", () => {
    expect(isCompleteReservationTime("20:21")).toBe(true);
    expect(isCompleteReservationTime("9:30")).toBe(true);
    expect(isCompleteReservationTime("20:2")).toBe(false);
    expect(isCompleteReservationTime("")).toBe(false);
  });
});

describe("parseReservationTime", () => {
  it("accepts every way a time gets typed", () => {
    expect(parseReservationTime("2021")).toBe("20:21");
    expect(parseReservationTime("20:21")).toBe("20:21");
    expect(parseReservationTime("930")).toBe("09:30");
    expect(parseReservationTime("9")).toBe("09:00");
    expect(parseReservationTime("20")).toBe("20:00");
    expect(parseReservationTime("0005")).toBe("00:05");
  });

  it("takes a lone minute digit as the tens, the digit typed first", () => {
    expect(parseReservationTime("20:3")).toBe("20:30");
  });

  it("refuses what is not a time of day", () => {
    expect(parseReservationTime("")).toBeNull();
    expect(parseReservationTime("abc")).toBeNull();
    expect(parseReservationTime("2530")).toBeNull();
    expect(parseReservationTime("2400")).toBeNull();
    expect(parseReservationTime("2060")).toBeNull();
    expect(parseReservationTime("20:7")).toBeNull();
  });
});

describe("stepping the time", () => {
  it("snaps an odd minute to the neighbouring quarter hour", () => {
    expect(stepReservationTime("20:21", 1)).toBe("20:30");
    expect(stepReservationTime("20:21", -1)).toBe("20:15");
  });

  it("moves a whole quarter from a quarter", () => {
    expect(stepReservationTime("20:30", 1)).toBe("20:45");
    expect(stepReservationTime("20:30", -1)).toBe("20:15");
  });

  it("never leaves the day", () => {
    expect(stepReservationTime("23:45", 1)).toBe("23:45");
    expect(stepReservationTime("23:50", 1)).toBe("23:50");
    expect(stepReservationTime("00:10", -1)).toBe("00:00");
    expect(stepReservationTime("00:00", -1)).toBe("00:00");
  });

  it("nudges a single minute for fine control, clamped to the day", () => {
    expect(nudgeReservationTime("20:21", 1)).toBe("20:22");
    expect(nudgeReservationTime("00:00", -1)).toBe("00:00");
    expect(nudgeReservationTime("23:59", 1)).toBe("23:59");
  });
});

describe("initialReservationWhen", () => {
  it("starts today on the next quarter hour", () => {
    expect(initialReservationWhen(new Date(2026, 8, 9, 19, 52))).toEqual({ choice: "today", date: "2026-09-09", time: "20:00" });
  });

  it("never starts on the quarter it already is", () => {
    expect(initialReservationWhen(new Date(2026, 8, 9, 19, 45)).time).toBe("20:00");
  });

  it("moves to tomorrow once the next quarter hour is past midnight", () => {
    expect(initialReservationWhen(new Date(2026, 8, 9, 23, 50))).toEqual({ choice: "tomorrow", date: "2026-09-10", time: "00:00" });
  });
});

describe("chooseReservationDay", () => {
  const now = new Date(2026, 8, 30, 12, 0);
  const evening: ReservationWhen = { choice: "today", date: "2026-09-30", time: "20:21" };

  it("pins today and tomorrow to real dates and keeps the time", () => {
    expect(chooseReservationDay(evening, "tomorrow", now)).toEqual({ choice: "tomorrow", date: "2026-10-01", time: "20:21" });
    expect(chooseReservationDay({ ...evening, choice: "date", date: "2026-10-20" }, "today", now)).toEqual(evening);
  });

  it("opens the calendar on the day already chosen", () => {
    expect(chooseReservationDay({ ...evening, choice: "tomorrow", date: "2026-10-01" }, "date", now)).toEqual({ choice: "date", date: "2026-10-01", time: "20:21" });
  });

  it("does not open the calendar on a day that can no longer be booked", () => {
    expect(chooseReservationDay({ ...evening, date: "2026-09-29" }, "date", now).date).toBe("2026-09-30");
  });

  it("keeps the time through a hold and back", () => {
    const hold = chooseReservationDay(evening, "now", now);
    expect(hold.choice).toBe("now");
    expect(chooseReservationDay(hold, "today", now).time).toBe("20:21");
  });
});

describe("reservationInstantFor", () => {
  it("gives a hold no instant, which is what takes the table now", () => {
    expect(reservationInstantFor({ choice: "now", date: "2026-09-09", time: "20:00" })).toBeNull();
  });

  it("lands on the chosen local day and minute", () => {
    const instant = reservationInstantFor({ choice: "date", date: "2026-12-24", time: "20:21" });

    expect(instant?.getFullYear()).toBe(2026);
    expect(instant?.getMonth()).toBe(11);
    expect(instant?.getDate()).toBe(24);
    expect(instant?.getHours()).toBe(20);
    expect(instant?.getMinutes()).toBe(21);
    expect(instant?.getSeconds()).toBe(0);
  });

  it("has no instant for a day or time that does not exist", () => {
    expect(reservationInstantFor({ choice: "date", date: "2026-02-30", time: "20:21" })).toBeNull();
    expect(reservationInstantFor({ choice: "today", date: "2026-09-09", time: "25:00" })).toBeNull();
  });
});

describe("reservationWhenProblem", () => {
  const now = new Date(2026, 8, 9, 19, 52);

  it("refuses a time that has already gone, the current minute included", () => {
    expect(reservationWhenProblem({ choice: "today", date: "2026-09-09", time: "19:30" }, now)).toBe("passed");
    expect(reservationWhenProblem({ choice: "today", date: "2026-09-09", time: "19:52" }, now)).toBe("passed");
    expect(reservationWhenProblem({ choice: "today", date: "2026-09-09", time: "20:21" }, now)).toBeNull();
  });

  it("catches a sheet left open across midnight", () => {
    expect(reservationWhenProblem({ choice: "today", date: "2026-09-08", time: "23:55" }, now)).toBe("passed");
  });

  it("books up to a year ahead and no further", () => {
    expect(reservationWhenProblem({ choice: "date", date: "2027-09-09", time: "12:00" }, now)).toBeNull();
    expect(reservationWhenProblem({ choice: "date", date: "2027-09-10", time: "12:00" }, now)).toBe("too_far");
  });

  it("calls an unreadable day or time invalid, and has nothing to check for a hold", () => {
    expect(reservationWhenProblem({ choice: "date", date: "someday", time: "20:00" }, now)).toBe("invalid");
    expect(reservationWhenProblem({ choice: "now", date: "", time: "" }, now)).toBeNull();
  });
});

describe("the calendar", () => {
  it("lets today be booked even late at night, but not yesterday", () => {
    const lateNight = new Date(2026, 8, 9, 23, 59);

    expect(reservationDayBookable("2026-09-09", lateNight)).toBe(true);
    expect(reservationDayBookable("2026-09-08", lateNight)).toBe(false);
    expect(reservationDayBookable("2027-09-09", lateNight)).toBe(true);
    expect(reservationDayBookable("2027-09-10", lateNight)).toBe(false);
  });

  it("lays a month out in whole weeks from Sunday", () => {
    // 1 September 2026 is a Tuesday.
    const cells = calendarMonthCells(2026, 8);
    const days = cells.filter(Boolean);

    expect(cells.slice(0, 3)).toEqual([null, null, "2026-09-01"]);
    expect(cells.length % 7).toBe(0);
    expect(days).toHaveLength(30);
    expect(days.at(-1)).toBe("2026-09-30");
  });
});

describe("reservationReminder", () => {
  it("shows the time alone only when the booking is today", () => {
    const now = new Date("2026-09-09T12:00:00");

    expect(reservationReminder("2026-09-09T16:00:00", now)).toBe("จอง 16:00");
    // Tomorrow morning read late tonight must not look like "in a few minutes".
    expect(reservationReminder("2026-09-10T09:30:00", now)).toMatch(/09:30/);
    expect(reservationReminder("2026-09-10T09:30:00", now)).not.toBe("จอง 09:30");
  });

  it("gives a table with no booking no reminder rather than an empty one", () => {
    const now = new Date("2026-09-09T12:00:00");

    expect(reservationReminder(null, now)).toBeNull();
    expect(reservationReminder(undefined, now)).toBeNull();
    expect(reservationReminder("", now)).toBeNull();
    expect(reservationReminder("not a date", now)).toBeNull();
  });
});

describe("reservation clocks", () => {
  it("prints the clock alone for the table card", () => {
    expect(reservationClock("2026-09-09T19:00:00")).toBe("19:00");
    expect(reservationClock(null)).toBeNull();
  });

  it("adds the date on a detail line only when it is not today", () => {
    const now = new Date("2026-09-09T12:00:00");

    expect(formatReservationClock("2026-09-09T19:00:00", "th", now)).toBe("19:00");
    expect(formatReservationClock("2026-09-10T19:00:00", "th", now)).toMatch(/19:00$/);
    expect(formatReservationClock("2026-09-10T19:00:00", "th", now)).not.toBe("19:00");
    expect(formatReservationClock(null)).toBe("-");
  });

  it("names the year once a booking is in a different one", () => {
    const now = new Date("2026-09-09T12:00:00");

    expect(formatReservationClock("2027-01-05T19:00:00", "en", now)).toMatch(/2027/);
    expect(formatReservationClock("2026-10-05T19:00:00", "en", now)).not.toMatch(/2026/);
  });
});
