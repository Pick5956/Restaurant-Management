import { apiRequest } from './client';
import { toMenuImageUploadPart } from './menu';
import { appendMenuImageUpload, type MenuImageUploadFile } from '@/src/lib/menu-image';
import type {
  AdminInvitation,
  Invitation,
  Membership,
  Restaurant,
  RestaurantAuditLog,
  RestaurantInput,
} from '@/src/types/restaurant';

export function getMyMemberships() {
  return apiRequest<{ memberships: Membership[] }>('/api/v1/restaurants/me', {
    skipRestaurant: true,
  });
}

export function createRestaurant(data: RestaurantInput) {
  return apiRequest<{ restaurant: Restaurant; membership: Membership }>('/api/v1/restaurants', {
    method: 'POST',
    skipRestaurant: true,
    body: JSON.stringify(data),
  });
}

export function getRestaurant(id: number) {
  return apiRequest<Restaurant>(`/api/v1/restaurants/${id}`, {
    skipRestaurant: true,
  });
}

export function updateRestaurant(id: number, data: RestaurantInput) {
  return apiRequest<{ restaurant: Restaurant }>(`/api/v1/restaurants/${id}`, {
    method: 'PATCH',
    skipRestaurant: true,
    body: JSON.stringify(data),
  });
}

export type RestaurantImageKind = 'logo' | 'cover' | 'promptpay-qr';

/**
 * Uploads the shop's logo, cover or PromptPay QR. The server stores the file
 * and writes it onto the restaurant straight away, the same endpoints the web
 * settings use; the returned restaurant carries the new URL.
 */
export async function uploadRestaurantImage(id: number, kind: RestaurantImageKind, source: MenuImageUploadFile) {
  const formData = new FormData();
  appendMenuImageUpload(formData, await toMenuImageUploadPart(source));
  return apiRequest<{ restaurant: Restaurant }>(`/api/v1/restaurants/${id}/upload-${kind}`, {
    method: 'POST',
    skipRestaurant: true,
    body: formData,
  });
}

export function listMembers(restaurantId: number) {
  return apiRequest<{ members: Membership[] }>(`/api/v1/restaurants/${restaurantId}/members`);
}

export function updateMemberStatus(restaurantId: number, memberId: number, status: Membership['status']) {
  return apiRequest<{ member: Membership }>(`/api/v1/restaurants/${restaurantId}/members/${memberId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function updateMemberRole(restaurantId: number, memberId: number, roleId: number) {
  return apiRequest<{ member: Membership }>(`/api/v1/restaurants/${restaurantId}/members/${memberId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role_id: roleId }),
  });
}

export function deleteRestaurant(id: number) {
  return apiRequest<{ status: string }>(`/api/v1/restaurants/${id}`, { method: 'DELETE', skipRestaurant: true });
}

export function updateMemberPermissions(restaurantId: number, memberId: number, permissions: string[] | null) {
  return apiRequest<{ member: Membership }>(`/api/v1/restaurants/${restaurantId}/members/${memberId}/permissions`, {
    method: 'PATCH',
    body: JSON.stringify({ use_role_permissions: permissions === null, permissions: permissions || [] }),
  });
}

export function createInvitation(restaurantId: number, data: { role_id: number; email?: string; expires_in_days?: number }) {
  return apiRequest<AdminInvitation>(`/api/v1/restaurants/${restaurantId}/invitations`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function listPendingInvitations(restaurantId: number) {
  return apiRequest<{ invitations: AdminInvitation[] }>(`/api/v1/restaurants/${restaurantId}/invitations`);
}

export function revokeInvitation(restaurantId: number, invitationId: number) {
  return apiRequest<{ status: string }>(`/api/v1/restaurants/${restaurantId}/invitations/${invitationId}`, {
    method: 'DELETE',
  });
}

export function getInvitationByToken(token: string) {
  return apiRequest<{ invitation: Invitation; usable: boolean }>(`/api/invitations/${token}`, {
    skipAuth: true,
    skipRestaurant: true,
  });
}

export function acceptInvitation(token: string) {
  return apiRequest<{ membership: Membership }>(`/api/v1/invitations/${token}/accept`, {
    method: 'POST',
    skipRestaurant: true,
  });
}

export function listAuditLogs(restaurantId: number, limit = 20, offset = 0) {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit) || 20));
  const safeOffset = Math.max(0, Math.trunc(offset) || 0);
  return apiRequest<{ logs: RestaurantAuditLog[]; has_more: boolean; next_offset: number }>(
    `/api/v1/restaurants/${restaurantId}/audit-logs?limit=${safeLimit}&offset=${safeOffset}`,
  );
}
