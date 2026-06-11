"use client";

import { useEffect } from "react";

/**
 * Capacitor glue, mounted once in the root layout. No-ops entirely in a
 * regular browser. In the native shell it:
 *  - registers for push and saves the FCM token via /api/me/fcm-token
 *  - routes deep links (appUrlOpen) into the web app
 */
export function NativeBridge() {
  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      const { App } = await import("@capacitor/app");
      const urlListener = await App.addListener("appUrlOpen", (event) => {
        try {
          const url = new URL(event.url);
          window.location.assign(url.pathname + url.search);
        } catch {
          // Ignore malformed deep links.
        }
      });
      cleanups.push(() => void urlListener.remove());

      const { PushNotifications } = await import("@capacitor/push-notifications");
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === "prompt") {
        permission = await PushNotifications.requestPermissions();
      }
      if (permission.receive !== "granted" || disposed) return;

      const registration = await PushNotifications.addListener("registration", (token) => {
        void fetch("/api/me/fcm-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.value }),
        });
      });
      cleanups.push(() => void registration.remove());

      const tapped = await PushNotifications.addListener("pushNotificationActionPerformed", () => {
        // Night-before notification → straight to the order card.
        window.location.assign("/dashboard");
      });
      cleanups.push(() => void tapped.remove());

      await PushNotifications.register();
    })().catch((error) => console.error("Native bridge init failed:", error));

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  return null;
}
