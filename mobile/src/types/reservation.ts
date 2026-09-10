import type { RestaurantTable } from '@/src/types/table';

export type ReservationStatus = 'active' | 'seated' | 'cancelled';

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
  /** When the guests said they would arrive. Null means the booking held the
   *  table immediately instead of being scheduled — see the backend entity. */
  reserved_for?: string | null;
  guest_count?: number;
  CreatedAt?: string;
  table?: RestaurantTable | null;
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
  /** RFC3339. Omit to hold the table now; send a time to book it for later and
   *  leave the table sellable until then. */
  reserved_for?: string;
  guest_count?: number;
}
