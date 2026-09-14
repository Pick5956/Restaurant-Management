import { Role } from "./role";
import { User } from "./auth";

export interface Restaurant {
  ID: number;
  name: string;
  /** URL name: the `krua-pick` in /r/krua-pick/home. */
  slug: string;
  branch_name: string;
  restaurant_type: string;
  address: string;
  phone: string;
  logo: string;
  open_time: string;
  close_time: string;
  table_count: number;
  service_charge_enabled: boolean;
  service_charge_rate: number;
  vat_enabled: boolean;
  vat_rate: number;
  promptpay_name: string;
  promptpay_qr_image: string;
  cover_image: string;
  /** QR-ordering geofence. Radius 0 or null coordinates disables the check. */
  latitude: number | null;
  longitude: number | null;
  order_radius_meters: number;
  owner_id: number;
  owner?: User;
  CreatedAt?: string;
  UpdatedAt?: string;
}

export type MembershipStatus = "active" | "suspended" | "removed";

export interface Membership {
  ID: number;
  user_id: number;
  restaurant_id: number;
  role_id: number;
  permissions_override?: string | null;
  status: MembershipStatus;
  joined_at: string;
  invited_by_user_id?: number | null;

  user?: User;
  restaurant?: Restaurant;
  role?: Role;
}

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Invitation {
  ID: number;
  restaurant_id: number;
  role_id: number;
  email: string;
  token: string;
  expires_at?: string | null;
  status: InvitationStatus;
  invited_by_user_id: number;
  accepted_at?: string | null;
  accepted_by_user_id?: number | null;

  restaurant?: Restaurant;
  role?: Role;
}

export interface RestaurantAuditLog {
  ID: number;
  restaurant_id: number;
  actor_user_id?: number | null;
  target_user_id?: number | null;
  invitation_id?: number | null;
  action: string;
  details: string;
  CreatedAt?: string;
  UpdatedAt?: string;

  actor_user?: User;
  target_user?: User;
  invitation?: Invitation;
}
