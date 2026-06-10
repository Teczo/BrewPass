import type { GeoPoint } from "@/lib/models";
import { TIMEZONE } from "@/lib/time";

export type WeatherCondition = "rain" | "clear" | "unknown";

/** WMO weather codes that mean rain/drizzle/showers/thunderstorm. */
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

/**
 * Daily weather for a KL date via Open-Meteo (free, no API key).
 * Best-effort: any failure returns "unknown" and the caller moves on —
 * weather only ever enriches suggestions, never blocks the engine.
 */
export async function getDailyWeather(geo: GeoPoint, localDate: string): Promise<WeatherCondition> {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", geo.lat.toString());
    url.searchParams.set("longitude", geo.lng.toString());
    url.searchParams.set("daily", "weather_code,precipitation_probability_max");
    url.searchParams.set("timezone", TIMEZONE);
    url.searchParams.set("start_date", localDate);
    url.searchParams.set("end_date", localDate);

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return "unknown";

    const data = (await response.json()) as {
      daily?: { weather_code?: number[]; precipitation_probability_max?: (number | null)[] };
    };
    const code = data.daily?.weather_code?.[0];
    const rainProbability = data.daily?.precipitation_probability_max?.[0];
    if (code === undefined) return "unknown";

    if (RAIN_CODES.has(code) || (rainProbability ?? 0) >= 60) return "rain";
    return "clear";
  } catch (error) {
    console.error("Weather lookup failed:", error);
    return "unknown";
  }
}

/** Per-run memo so one cron run hits Open-Meteo once per ~11km cell. */
export function makeWeatherCache() {
  const cache = new Map<string, Promise<WeatherCondition>>();
  return (geo: GeoPoint, localDate: string): Promise<WeatherCondition> => {
    const key = `${geo.lat.toFixed(1)},${geo.lng.toFixed(1)},${localDate}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = getDailyWeather(geo, localDate);
      cache.set(key, hit);
    }
    return hit;
  };
}
