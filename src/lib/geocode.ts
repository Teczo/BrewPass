import { requireEnv } from "@/lib/env";
import type { GeoPoint } from "@/lib/models";

export interface GeocodeResult {
  geo: GeoPoint;
  formattedAddress: string;
}

/** Coordinates → human-readable address (native "use my location" flow).
 * Server-side only, same key handling as forward geocoding. */
export async function reverseGeocode(point: GeoPoint): Promise<string | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${point.lat},${point.lng}`);
  url.searchParams.set("key", requireEnv("GOOGLE_MAPS_API_KEY"));

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Reverse geocoding request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    status: string;
    results: Array<{ formatted_address: string }>;
  };
  if (data.status !== "OK") return null;
  return data.results[0]?.formatted_address ?? null;
}

/**
 * Geocode an address via the Google Maps Geocoding API. Server-side only —
 * the API key must never reach the client. Returns null when the address
 * cannot be resolved.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("region", "my");
  url.searchParams.set("key", requireEnv("GOOGLE_MAPS_API_KEY"));

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Geocoding request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    status: string;
    error_message?: string;
    results: Array<{
      formatted_address: string;
      geometry: { location: { lat: number; lng: number } };
    }>;
  };

  if (data.status === "ZERO_RESULTS") return null;
  if (data.status !== "OK") {
    throw new Error(`Geocoding failed: ${data.status} ${data.error_message ?? ""}`.trim());
  }

  const [best] = data.results;
  if (!best) return null;

  return {
    geo: { lat: best.geometry.location.lat, lng: best.geometry.location.lng },
    formattedAddress: best.formatted_address,
  };
}
