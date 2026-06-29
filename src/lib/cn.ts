type ClassValue = string | number | false | null | undefined;

/**
 * Minimal className joiner. Keeps the design-system primitives dependency-free
 * (no clsx/tailwind-merge in this project). Falsy values are dropped.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
