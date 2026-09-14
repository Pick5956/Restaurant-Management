import { apiClient } from "./apiClient";
import { Membership, MembershipStatus, Restaurant, RestaurantAuditLog } from "../types/restaurant";

export interface CreateRestaurantInput {
  name: string;
  /** URL name for /r/<slug>. Optional on create (derived from the name when
   *  empty); on update, omit it to keep the stored one. */
  slug?: string;
  branch_name: string;
  restaurant_type: string;
  address?: string;
  phone?: string;
  logo?: string;
  open_time?: string;
  close_time?: string;
  table_count?: number;
  service_charge_enabled?: boolean;
  service_charge_rate?: number;
  vat_enabled?: boolean;
  vat_rate?: number;
  promptpay_name?: string;
  promptpay_qr_image?: string;
  cover_image?: string;
  /** Whether to split the starter tables into zones. Omit for the zoned default. */
  split_zones?: boolean;
  /** QR-ordering geofence. Send null coordinates or radius 0 to disable it. */
  latitude?: number | null;
  longitude?: number | null;
  order_radius_meters?: number;
}

export type UpdateRestaurantInput = CreateRestaurantInput;

export const createRestaurant = (data: CreateRestaurantInput) =>
  apiClient.post<{ restaurant: Restaurant; membership: Membership }>(
    "/api/v1/restaurants",
    data
  );

export type RestaurantSlugAvailability = {
  slug: string;
  available: boolean;
  reason?: "invalid" | "taken";
};

/** Advisory check while the owner types; create and update check again. */
export const checkRestaurantSlug = (slug: string, restaurantId?: number) =>
  apiClient.get<RestaurantSlugAvailability>("/api/v1/restaurants/slug-availability", {
    params: restaurantId ? { slug, restaurant_id: restaurantId } : { slug },
  });

export const getMyMemberships = () =>
  apiClient.get<{ memberships: Membership[] }>("/api/v1/restaurants/me");

export const getRestaurant = (id: number) =>
  apiClient.get<Restaurant>(`/api/v1/restaurants/${id}`);

export const updateRestaurant = (id: number, data: UpdateRestaurantInput) =>
  apiClient.patch<{ restaurant: Restaurant }>(`/api/v1/restaurants/${id}`, data);

export const uploadRestaurantLogo = (id: number, file: File) => {
  const formData = new FormData();
  formData.append("image", file);
  return apiClient.post<{ restaurant: Restaurant }>(`/api/v1/restaurants/${id}/upload-logo`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
};

export const uploadRestaurantCover = (id: number, file: File) => {
  const formData = new FormData();
  formData.append("image", file);
  return apiClient.post<{ restaurant: Restaurant }>(`/api/v1/restaurants/${id}/upload-cover`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
};

export const uploadRestaurantPromptPayQR = (id: number, file: File) => {
  const formData = new FormData();
  formData.append("image", file);
  return apiClient.post<{ restaurant: Restaurant }>(`/api/v1/restaurants/${id}/upload-promptpay-qr`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
};

export const listMembers = (id: number) =>
  apiClient.get<{ members: Membership[] }>(`/api/v1/restaurants/${id}/members`);

export const updateMemberStatus = (restaurantId: number, memberId: number, status: MembershipStatus) =>
  apiClient.patch<{ member: Membership }>(`/api/v1/restaurants/${restaurantId}/members/${memberId}/status`, {
    status,
  });

export const updateMemberRole = (restaurantId: number, memberId: number, roleId: number) =>
  apiClient.patch<{ member: Membership }>(`/api/v1/restaurants/${restaurantId}/members/${memberId}/role`, {
    role_id: roleId,
  });

export const updateMemberPermissions = (restaurantId: number, memberId: number, permissions: string[] | null) =>
  apiClient.patch<{ member: Membership }>(`/api/v1/restaurants/${restaurantId}/members/${memberId}/permissions`, {
    use_role_permissions: permissions === null,
    permissions: permissions ?? [],
  });

export const listAuditLogs = (restaurantId: number, limit = 20, offset = 0) =>
  apiClient.get<{ logs: RestaurantAuditLog[]; has_more?: boolean; next_offset?: number }>(`/api/v1/restaurants/${restaurantId}/audit-logs`, {
    params: { limit, offset },
  });

export const deleteRestaurant = (id: number) =>
  apiClient.delete<{ status: string }>(`/api/v1/restaurants/${id}`);

