import type { CapacitorConfig } from "@capacitor/cli";

/**
 * BrewPass is a server-rendered Next.js app (Auth0 sessions, API routes,
 * crons), so the native shell loads the hosted app rather than a static
 * export. `webDir` only holds the offline fallback shell.
 *
 * Set CAP_SERVER_URL to your deployment before `npx cap sync`
 * (defaults to the production domain).
 */
const config: CapacitorConfig = {
  appId: "com.brewpass.app",
  appName: "BrewPass",
  webDir: "mobile-shell",
  server: {
    url: process.env.CAP_SERVER_URL ?? "https://brewpass.vercel.app",
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
