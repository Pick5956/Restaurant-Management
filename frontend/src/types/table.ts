export type TableStatus = "free" | "occupied" | "reserved" | "inactive";

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
  reservation_name?: string;
  reservation_phone?: string;
  /** The next booking for later on this table, from an hour back to twelve
   *  hours ahead. Attached by the table list; a hold is the table's status. */
  upcoming_reservation_at?: string | null;
  upcoming_reservation_name?: string | null;
  table_zone?: TableZone | null;
  CreatedAt?: string;
  UpdatedAt?: string;
}

export interface RestaurantTableInput {
  zone_id?: number | null;
  capacity: number;
  status: TableStatus;
}

export interface BulkCreateTablesInput {
  zone_id?: number | null;
  count: number;
  capacity: number;
  status?: TableStatus;
}

export interface MoveTableZoneInput {
  zone_id?: number | null;
}

export interface TableZone {
  ID: number;
  restaurant_id: number;
  name: string;
  prefix: string;
  display_order: number;
  is_active: boolean;
  CreatedAt?: string;
  UpdatedAt?: string;
}

export interface TableZoneInput {
  name: string;
  prefix?: string;
  display_order: number;
  is_active: boolean;
}
