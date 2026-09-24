import axios from "axios";
import { authRepository } from "../app/repositories/authRepository";
import { restaurantRepository } from "../app/repositories/restaurantRepository";
import { normalizeApiMediaUrls } from "./mediaUrl";

const localhostHosts = new Set(["localhost", "127.0.0.1"]);
const publicFrontendHosts = new Set(["dishy.pro", "www.dishy.pro"]);

function resolveApiUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL?.trim();

  if (typeof window === "undefined") {
    return configuredUrl || "http://localhost:8080";
  }

  const currentHost = window.location.hostname;
  const fallbackUrl = `${window.location.protocol}//${currentHost}:8080`;

  if (publicFrontendHosts.has(currentHost)) {
    return "https://api.dishy.pro";
  }

  if (!configuredUrl) {
    return fallbackUrl;
  }

  try {
    const parsed = new URL(configuredUrl);
    if (localhostHosts.has(parsed.hostname) && !localhostHosts.has(currentHost)) {
      parsed.hostname = currentHost;
      return parsed.toString().replace(/\/$/, "");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return configuredUrl;
  }
}

export const apiUrl = resolveApiUrl();

export const apiClient = axios.create({
  baseURL: apiUrl,
  headers: {
    "Content-Type": "application/json",
  },
});

export const publicApiClient = axios.create({
  baseURL: apiUrl,
  headers: {
    "Content-Type": "application/json",
  },
});

function normalizeResponseMedia<T extends { data: unknown }>(response: T) {
  response.data = normalizeApiMediaUrls(response.data, apiUrl);
  return response;
}

publicApiClient.interceptors.response.use(normalizeResponseMedia);

// Inject Authorization + X-Restaurant-ID on every request.
// X-Restaurant-ID identifies which restaurant the current user is acting in
// (a user can be a member of many restaurants).
apiClient.interceptors.request.use((config) => {
  const token = authRepository.getToken();
  const tokenType = authRepository.getTokenType();
  if (token && tokenType && config.headers) {
    config.headers.Authorization = `${tokenType} ${token}`;
  }

  const activeRestaurantId = restaurantRepository.getActiveId();
  if (activeRestaurantId && config.headers) {
    config.headers["X-Restaurant-ID"] = String(activeRestaurantId);
  }

  return config;
});

// The backend's answers that mean this tab's restaurant binding itself is
// wrong: the X-Restaurant-ID header does not parse, or the user is no longer an
// active member there (auth.RestaurantScope and the membership checks behind
// it). Any other 400/403 that merely names a restaurant - a missing
// manage_restaurant_settings permission, a slug already taken, an owner-only
// action - is about the request, and must leave the tab where it is.
const staleRestaurantBindingErrors = new Set([
  "invalid x-restaurant-id",
  "not a member of this restaurant",
  "not an active member of this restaurant",
]);

export function isStaleRestaurantBindingError(status: unknown, message: unknown): boolean {
  if (status !== 400 && status !== 403) return false;
  return staleRestaurantBindingErrors.has(String(message ?? "").trim().toLowerCase());
}

apiClient.interceptors.response.use(
  normalizeResponseMedia,
  (error) => {
    if (isStaleRestaurantBindingError(error?.response?.status, error?.response?.data?.error)) {
      restaurantRepository.clearActiveId();
    }
    return Promise.reject(error);
  }
);
