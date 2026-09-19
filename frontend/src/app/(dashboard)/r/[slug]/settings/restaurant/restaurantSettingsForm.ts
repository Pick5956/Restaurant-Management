import type { Restaurant } from "@/src/types/restaurant";
import { RESTAURANT_TYPES } from "@/src/app/restaurants/restaurantWorkspaceUi";

// The restaurant settings save each setting the moment it is changed, as the
// reference settings page does - there is no save button. Everything here is
// pure so the rules for "what goes to the server when one field changes" can
// be tested without a page.

export type FormState = {
  name: string;
  slug: string;
  branch_name: string;
  restaurant_type: string;
  phone: string;
  address: string;
  open_time: string;
  close_time: string;
  table_count: string;
  logo: string;
  cover_image: string;
  service_charge_enabled: boolean;
  service_charge_rate: string;
  vat_enabled: boolean;
  vat_rate: string;
  promptpay_name: string;
  promptpay_qr_image: string;
  geofence_enabled: boolean;
  latitude: string;
  longitude: string;
  order_radius_meters: string;
};

export type FormField = keyof FormState;

export type ErrorField = "name" | "slug" | "branch_name" | "phone" | "open_time" | "close_time" | "table_count" | "service_charge_rate" | "vat_rate" | "latitude" | "order_radius_meters";
export type FormErrors = Partial<Record<ErrorField, string>>;

export type ValidationMessages = {
  validateName: string;
  validateBranch: string;
  validatePhone: string;
  validateOpen: string;
  validateClose: string;
  validateTables: string;
  validateService: string;
  validateVat: string;
  validateCoords: string;
  validateRadius: string;
};

// Thai numbers are 9 digits (landline) or 10 (mobile), so keep digits only and
// stop the input at 10 instead of letting it grow past a real phone number.
const PHONE_MAX_DIGITS = 10;

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "").slice(0, PHONE_MAX_DIGITS);
}

export function validateTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function toForm(restaurant?: Partial<Restaurant> | null, language: "th" | "en" = "th"): FormState {
  return {
    name: restaurant?.name ?? "",
    slug: restaurant?.slug ?? "",
    branch_name: restaurant?.branch_name?.trim() || (language === "th" ? "สาขาหลัก" : "Main branch"),
    restaurant_type: restaurant?.restaurant_type?.trim() || RESTAURANT_TYPES[0],
    phone: normalizePhone(restaurant?.phone ?? ""),
    address: restaurant?.address ?? "",
    open_time: restaurant?.open_time || "17:00",
    close_time: restaurant?.close_time || "00:00",
    table_count: restaurant?.table_count ? String(restaurant.table_count) : "12",
    logo: restaurant?.logo ?? "",
    cover_image: restaurant?.cover_image ?? "",
    service_charge_enabled: Boolean(restaurant?.service_charge_enabled),
    service_charge_rate: String(restaurant?.service_charge_rate ?? 10),
    vat_enabled: Boolean(restaurant?.vat_enabled),
    vat_rate: String(restaurant?.vat_rate ?? 7),
    promptpay_name: restaurant?.promptpay_name ?? "",
    promptpay_qr_image: restaurant?.promptpay_qr_image ?? "",
    geofence_enabled: Boolean(restaurant?.order_radius_meters && restaurant.latitude != null && restaurant.longitude != null),
    latitude: restaurant?.latitude != null ? String(restaurant.latitude) : "",
    longitude: restaurant?.longitude != null ? String(restaurant.longitude) : "",
    order_radius_meters: restaurant?.order_radius_meters ? String(restaurant.order_radius_meters) : "150",
  };
}

export function validateRestaurantForm(form: FormState, messages: ValidationMessages): FormErrors {
  const next: FormErrors = {};
  const tableCount = Number.parseInt(form.table_count, 10);
  const serviceRate = Number.parseFloat(form.service_charge_rate);
  const vatRate = Number.parseFloat(form.vat_rate);
  if (!form.name.trim()) next.name = messages.validateName;
  if (!form.branch_name.trim()) next.branch_name = messages.validateBranch;
  if (form.phone.trim() && form.phone.replace(/\D/g, "").length < 9) next.phone = messages.validatePhone;
  if (!validateTime(form.open_time)) next.open_time = messages.validateOpen;
  if (!validateTime(form.close_time)) next.close_time = messages.validateClose;
  if (!Number.isFinite(tableCount) || tableCount < 1 || tableCount > 500) next.table_count = messages.validateTables;
  if (!Number.isFinite(serviceRate) || serviceRate < 0 || serviceRate > 30) next.service_charge_rate = messages.validateService;
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 20) next.vat_rate = messages.validateVat;
  if (form.geofence_enabled) {
    const latitude = Number.parseFloat(form.latitude);
    const longitude = Number.parseFloat(form.longitude);
    const radius = Number.parseInt(form.order_radius_meters, 10);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      next.latitude = messages.validateCoords;
    }
    if (!Number.isFinite(radius) || radius < 20 || radius > 5000) next.order_radius_meters = messages.validateRadius;
  }
  return next;
}

/** The body updateRestaurant expects. The slug is sent only when it changed. */
export function buildRestaurantPayload(form: FormState, savedSlug: string) {
  return {
    name: form.name.trim(),
    ...(form.slug !== savedSlug ? { slug: form.slug } : {}),
    branch_name: form.branch_name.trim(),
    restaurant_type: form.restaurant_type,
    phone: form.phone.trim(),
    address: form.address.trim(),
    open_time: form.open_time,
    close_time: form.close_time,
    table_count: Number.parseInt(form.table_count, 10),
    service_charge_enabled: form.service_charge_enabled,
    service_charge_rate: Number.parseFloat(form.service_charge_rate),
    vat_enabled: form.vat_enabled,
    vat_rate: Number.parseFloat(form.vat_rate),
    promptpay_name: form.promptpay_name.trim(),
    promptpay_qr_image: form.promptpay_qr_image.trim(),
    cover_image: form.cover_image.trim(),
    latitude: form.geofence_enabled ? Number.parseFloat(form.latitude) : null,
    longitude: form.geofence_enabled ? Number.parseFloat(form.longitude) : null,
    order_radius_meters: form.geofence_enabled ? Number.parseInt(form.order_radius_meters, 10) : 0,
  };
}

/** The location check is one setting spread over four controls: it is only
 *  valid - and only saved - as a whole. */
export const GEOFENCE_FIELDS: FormField[] = ["geofence_enabled", "latitude", "longitude", "order_radius_meters"];

/** The fields a change to `fields` has to carry with it. */
export function expandFields(fields: FormField[]): FormField[] {
  const touchesGeofence = fields.some((field) => GEOFENCE_FIELDS.includes(field));
  return Array.from(new Set([...fields, ...(touchesGeofence ? GEOFENCE_FIELDS : [])]));
}

/** Which error slots belong to a set of fields (longitude reports on latitude). */
function errorFieldsFor(fields: FormField[]): ErrorField[] {
  return fields.flatMap((field): ErrorField[] => {
    if (field === "longitude" || field === "latitude") return ["latitude"];
    if (field === "geofence_enabled") return ["latitude", "order_radius_meters"];
    const known: ErrorField[] = ["name", "slug", "branch_name", "phone", "open_time", "close_time", "table_count", "service_charge_rate", "vat_rate", "order_radius_meters"];
    return known.includes(field as ErrorField) ? [field as ErrorField] : [];
  });
}

export type CommitPlan =
  | { kind: "unchanged" }
  | { kind: "invalid"; errors: FormErrors }
  | { kind: "save"; candidate: FormState };

/**
 * What saving `fields` should do. The candidate is the last saved state with
 * only those fields taken from what is on screen, so a half-typed value in a
 * different field is never sent along. Only the errors of the fields being
 * saved are reported; the rest of the saved state was valid when it was saved.
 */
export function planCommit(saved: FormState, current: FormState, fields: FormField[], messages: ValidationMessages): CommitPlan {
  const expanded = expandFields(fields);
  const candidate: FormState = { ...saved };
  for (const field of expanded) {
    (candidate as Record<FormField, unknown>)[field] = current[field];
  }
  if (expanded.every((field) => candidate[field] === saved[field])) return { kind: "unchanged" };

  const all = validateRestaurantForm(candidate, messages);
  const errors: FormErrors = {};
  for (const slot of errorFieldsFor(expanded)) {
    if (all[slot]) errors[slot] = all[slot];
  }
  return Object.keys(errors).length ? { kind: "invalid", errors } : { kind: "save", candidate };
}

/** On screen after a save: the saved fields take the server's answer, every
 *  other field keeps whatever is still being typed there. */
export function mergeSaved(current: FormState, saved: FormState, fields: FormField[]): FormState {
  const next: FormState = { ...current };
  for (const field of expandFields(fields)) {
    (next as Record<FormField, unknown>)[field] = saved[field];
  }
  return next;
}
