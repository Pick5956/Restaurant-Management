import { apiClient } from "./apiClient";
import { Invitation, Membership } from "../types/restaurant";

export interface CreateInvitationInput {
  role_id: number;
  email?: string;
  expires_in_days?: number; // 0 or omitted = no expiry
}

export const createInvitation = (restaurantId: number, data: CreateInvitationInput) =>
  apiClient.post<Invitation>(`/api/v1/restaurants/${restaurantId}/invitations`, data);

export const listPendingInvitations = (restaurantId: number) =>
  apiClient.get<{ invitations: Invitation[] }>(`/api/v1/restaurants/${restaurantId}/invitations`);

/** Every recent invitation, open or closed: the staff page's record of links. */
export const listAllInvitations = (restaurantId: number) =>
  apiClient.get<{ invitations: Invitation[] }>(`/api/v1/restaurants/${restaurantId}/invitations`, { params: { scope: "all" } });

export const revokeInvitation =(restaurantId: number, invitationId: number) =>
  apiClient.delete(`/api/v1/restaurants/${restaurantId}/invitations/${invitationId}`);

// Public — invitee can preview before logging in.
export const getInvitationByToken = (token: string) =>
  apiClient.get<{ invitation: Invitation; usable: boolean }>(`/api/invitations/${token}`);

export const acceptInvitation = (token: string) =>
  apiClient.post<{ membership: Membership }>(`/api/v1/invitations/${token}/accept`);

export const invitationEmailMismatch = (
  invitationEmail?: string,
  currentUserEmail?: string,
) => {
  const invited = invitationEmail?.trim().toLowerCase() ?? "";
  const current = currentUserEmail?.trim().toLowerCase() ?? "";
  if (!invited || !current || invited.includes("*")) {
    return false;
  }
  return invited !== current;
};
