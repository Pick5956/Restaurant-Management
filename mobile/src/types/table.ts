export type TableStatus = 'free' | 'occupied' | 'reserved' | 'inactive';

export interface TableZone {
  ID: number;
  restaurant_id: number;
  name: string;
  prefix: string;
  display_order: number;
  is_active: boolean;
}

export interface TableZoneInput {
  name: string;
  prefix?: string;
  display_order: number;
  is_active: boolean;
}

export interface TableTag {
  ID: number;
  restaurant_id: number;
  name: string;
  display_order: number;
  is_active: boolean;
}

export interface TableTagInput {
  name: string;
  color?: string;
  display_order: number;
  is_active: boolean;
}

export interface RestaurantTable {
  ID: number;
  restaurant_id: number;
  zone_id?: number | null;
  table_number: string;
  display_label: string;
  sequence_number: number;
  capacity: number;
  zone: string;
  status: TableStatus;
  customer_token?: string;
  reservation_phone?: string;
  reservation_name?: string;
  /** The next booking due on this table, within an hour past and twelve hours
   *  ahead. A scheduled booking does not take the table out of service, so this
   *  is the only sign of it on the table map. */
  upcoming_reservation_at?: string | null;
  upcoming_reservation_name?: string | null;
  table_zone?: TableZone | null;
  tags?: TableTag[];
}

export interface RestaurantTableInput {
  zone_id?: number | null;
  capacity: number;
  status: TableStatus;
  tag_ids?: number[];
}

export interface BulkCreateTablesInput {
  zone_id?: number | null;
  count: number;
  capacity: number;
  status?: TableStatus;
  tag_ids?: number[];
}

export interface MoveTableZoneInput {
  zone_id?: number | null;
}
