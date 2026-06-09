/**
 * Read a required environment variable, failing loudly at the point of use.
 * Lazy lookup (not at module load) so `next build` succeeds without secrets.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
