/** Absolute base URL of this app, no trailing slash. */
export function appBaseUrl(): string {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "");
}
