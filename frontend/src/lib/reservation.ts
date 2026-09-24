import { apiClient } from "./apiClient";
import type { RestaurantTable } from "../types/table";

export type ReservationStatus = "active" | "seated" | "cancelled";

export interface Reservation {
  ID: number;
  restaurant_id: number;
  table_id: number;
  table_label: string;
  name: string;
  phone: string;
  status: ReservationStatus;
  reserved_by_user_id: number;
  resolved_at?: string | null;
  /** When the guests said they would arrive. Null means the booking holds the
   *  table now instead of being scheduled - see decisions/reservation-hold-vs-scheduled. */
  reserved_for?: string | null;
  guest_count?: number;
  CreatedAt?: string;
  table?: RestaurantTable;
}

export interface ReservationListResponse {
  reservations: Reservation[];
  has_more: boolean;
  next_offset: number;
  counts: Partial<Record<ReservationStatus, number>>;
}

export interface ReserveTableInput {
  reservation_phone: string;
  reservation_name?: string;
  guest_count?: number;
  /** RFC3339. Omit to hold the table now; send a time to book it for later and
   *  leave the table sellable until then. */
  reserved_for?: string;
}

/**
 * The request body for a booking. A hold must not carry `reserved_for` at all:
 * its absence is what tells the backend to take the table out of service now,
 * and a booking that always sent a time would schedule what staff meant to hold.
 */
export function reserveTableInput({
  phone,
  name,
  guestCount,
  instant,
}: {
  phone: string;
  name: string;
  guestCount: number;
  instant: Date | null;
}): ReserveTableInput {
  return {
    reservation_phone: phone.trim(),
    reservation_name: name.trim(),
    guest_count: Math.max(1, Math.trunc(guestCount) || 1),
    ...(instant ? { reserved_for: instant.toISOString() } : {}),
  };
}

// Reserve a table: hold it now, or book it for later when reserved_for is set.
export const reserveTable = (id: number, input: ReserveTableInput) =>
  apiClient.post<RestaurantTable>(`/api/v1/tables/${id}/reserve`, input);

// Cancel the reservation that holds a table (marks it cancelled / no-show).
export const cancelReservation = (id: number) =>
  apiClient.post<RestaurantTable>(`/api/v1/tables/${id}/cancel-reservation`);

/**
 * Close one booking as seated or cancelled, whichever kind it is. Keyed by the
 * booking rather than its table: a booking for later never takes its table's
 * status, so the table-keyed routes cannot reach it.
 */
export const resolveReservation = (id: number, status: "seated" | "cancelled") =>
  apiClient.post<Reservation>(`/api/v1/reservations/${id}/resolve`, { status });

export const listReservations = (params: { status?: ReservationStatus; limit?: number; offset?: number } = {}) =>
  apiClient.get<ReservationListResponse>("/api/v1/reservations", { params });

/**
 * The active booking behind a reserved table. A table can carry a hold and
 * several bookings for later at once, so the hold wins; any active booking on
 * the table is the fallback.
 */
export function findTableHold(reservations: readonly Reservation[], tableId: number): Reservation | null {
  const active = reservations.filter((item) => item.table_id === tableId && item.status === "active");
  return active.find((item) => !item.reserved_for) ?? active[0] ?? null;
}

const reservationErrors: Record<string, { th: string; en: string }> = {
  "table is already booked for that time": {
    th: "โต๊ะนี้มีการจองเวลานี้แล้ว",
    en: "This table is already booked for that time.",
  },
  "table is not free": {
    th: "โต๊ะนี้ไม่ว่างแล้ว เลือกจองล่วงหน้าแทน",
    en: "This table is no longer free. Book it for later instead.",
  },
  "table has an open order": {
    th: "โต๊ะนี้มีออเดอร์เปิดอยู่ เลือกจองล่วงหน้าแทน",
    en: "This table has an open order. Book it for later instead.",
  },
  "table is inactive": {
    th: "โต๊ะนี้ปิดใช้งานอยู่",
    en: "This table is inactive.",
  },
  "reservation phone is required": {
    th: "กรุณาใส่เบอร์ลูกค้าที่จองอย่างน้อย 9 หลัก",
    en: "Enter the customer's phone number with at least 9 digits.",
  },
  "reservation is already resolved": {
    th: "รายการนี้ถูกปิดไปแล้ว",
    en: "This reservation was already closed.",
  },
  "reservation not found": {
    th: "ไม่พบรายการจองนี้",
    en: "This reservation could not be found.",
  },
  "table is not reserved": {
    th: "โต๊ะนี้ไม่มีการจองแล้ว",
    en: "This table is no longer reserved.",
  },
};

/**
 * The backend's reservation errors in the staff member's language. Anything
 * unmapped gets the caller's own copy: the API's English is never shown.
 */
export function reservationErrorMessage(raw: string, language: "th" | "en", fallback = ""): string {
  const known = reservationErrors[raw.trim().toLowerCase()];
  return known ? known[language] : fallback;
}
