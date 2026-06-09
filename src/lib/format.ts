/** Format integer sen as a ringgit string, e.g. 14900 → "RM149". */
export function formatMyr(sen: number): string {
  const whole = Math.floor(sen / 100);
  const cents = sen % 100;
  return cents === 0 ? `RM${whole}` : `RM${whole}.${cents.toString().padStart(2, "0")}`;
}
