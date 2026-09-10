import { apiRequest } from './client';
import {
  buildReservationActionPath,
  buildReservationListPath,
  buildReservationResolvePath,
  type ReservationListQuery,
} from '@/src/lib/reservation-query';
import type {
  Reservation,
  ReservationListResponse,
  ReserveTableInput,
} from '@/src/types/reservation';
import type { RestaurantTable } from '@/src/types/table';

export function listReservations(params?: ReservationListQuery) {
  return apiRequest<ReservationListResponse>(buildReservationListPath(params));
}

export function reserveTable(tableId: number, data: ReserveTableInput) {
  return apiRequest<RestaurantTable>(buildReservationActionPath(tableId, 'reserve'), {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function cancelReservation(tableId: number) {
  return apiRequest<RestaurantTable>(buildReservationActionPath(tableId, 'cancel'), {
    method: 'POST',
  });
}

/** Closes one booking as seated or cancelled, whichever kind it is. */
export function resolveReservation(reservationId: number, status: 'seated' | 'cancelled') {
  return apiRequest<Reservation>(buildReservationResolvePath(reservationId), {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}
