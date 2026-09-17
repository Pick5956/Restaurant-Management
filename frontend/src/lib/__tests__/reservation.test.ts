import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findTableHold, reservationErrorMessage, reserveTableInput, type Reservation } from "../reservation";

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

// The call sites are the whole feature. A booking that always sent a time would
// schedule what staff meant to hold, one that never sent it would take a table
// out of service for an evening booking made at lunchtime, and a booking without
// the party size arrives with no idea how many are coming.
describe("reservation call sites", () => {
  const posPage = read("src/app/(dashboard)/r/[slug]/pos/tables/page.tsx");
  const history = read("src/components/tables/ReservationHistoryModal.tsx");

  it("books through reserveTableInput with the chosen instant and the guest count", () => {
    expect(posPage).toMatch(/const instant = reservationInstantFor\(reservationWhen\);/);
    expect(posPage).toMatch(/reserveTableInput\(\{\s*phone: reservationPhone,\s*name: reservationName,\s*guestCount: customerCount,\s*instant,\s*\}\)/);
  });

  it("refuses a time that has passed, is too far out, or is not a time, before booking", () => {
    expect(posPage).toMatch(/const problem = reservationWhenProblem\(reservationWhen, now\);\s*if \(problem\) \{[^}]*return;\s*\}\s*const instant = /);
  });

  it("feeds the picker's changes into the draft the booking is read from", () => {
    expect(posPage).toMatch(/<ReservationWhenPicker\s+value=\{reservationWhen\}\s+onChange=\{\(next\) => \{\s*setReservationWhen\(next\);/);
  });

  it("closes a booking from history by its id, whichever kind it is", () => {
    expect(history).toMatch(/resolveReservation\(reservation\.ID, status\)/);
  });
});

const booking = (overrides: Partial<Reservation>): Reservation => ({
  ID: 1,
  restaurant_id: 1,
  table_id: 7,
  table_label: "T7",
  name: "คุณทดสอบ",
  phone: "0800000000",
  status: "active",
  reserved_by_user_id: 1,
  ...overrides,
});

describe("reserveTableInput", () => {
  it("sends no reserved_for for a hold, which is what takes the table now", () => {
    const input = reserveTableInput({ phone: " 0800000000 ", name: " คุณทดสอบ ", guestCount: 4, instant: null });

    expect(input).toEqual({ reservation_phone: "0800000000", reservation_name: "คุณทดสอบ", guest_count: 4 });
    expect("reserved_for" in input).toBe(false);
  });

  it("sends the instant for a booking later, leaving the table sellable until then", () => {
    const instant = new Date("2026-09-09T19:30:00");
    const input = reserveTableInput({ phone: "0800000000", name: "", guestCount: 2, instant });

    expect(input.reserved_for).toBe(instant.toISOString());
    expect(input.guest_count).toBe(2);
  });

  it("never sends a party smaller than one", () => {
    expect(reserveTableInput({ phone: "0800000000", name: "", guestCount: 0, instant: null }).guest_count).toBe(1);
  });
});

describe("findTableHold", () => {
  it("prefers the booking that holds the table over a later one for the same table", () => {
    const later = booking({ ID: 2, reserved_for: "2026-09-09T19:00:00" });
    const hold = booking({ ID: 3, reserved_for: null, guest_count: 5 });

    expect(findTableHold([later, hold], 7)?.ID).toBe(3);
  });

  it("falls back to any active booking on the table, and ignores other tables", () => {
    const later = booking({ ID: 2, reserved_for: "2026-09-09T19:00:00" });

    expect(findTableHold([later], 7)?.ID).toBe(2);
    expect(findTableHold([later], 8)).toBeNull();
    expect(findTableHold([booking({ status: "seated" })], 7)).toBeNull();
  });
});

describe("reservationErrorMessage", () => {
  it("names the clash when the slot is already booked", () => {
    expect(reservationErrorMessage("table is already booked for that time", "th")).toBe("โต๊ะนี้มีการจองเวลานี้แล้ว");
    expect(reservationErrorMessage("table is already booked for that time", "en")).toBe("This table is already booked for that time.");
  });

  it("points a hold on a busy table at booking for later", () => {
    expect(reservationErrorMessage("table is not free", "th")).toMatch(/จองล่วงหน้า/);
    expect(reservationErrorMessage("table has an open order", "en")).toMatch(/later/);
  });

  it("keeps an unknown server message, and falls back when there is none", () => {
    expect(reservationErrorMessage("something unexpected", "th", "fallback")).toBe("something unexpected");
    expect(reservationErrorMessage("", "th", "fallback")).toBe("fallback");
  });
});
