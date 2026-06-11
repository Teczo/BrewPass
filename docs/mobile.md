# BrewPass Mobile (Capacitor)

The native apps are thin Capacitor shells that load the deployed web app
(`server.url` in `capacitor.config.ts`). The web build stays server-rendered
on Vercel — there is no static export.

## What's already wired in this repo

- `capacitor.config.ts` — app id `com.brewpass.app`, remote `server.url`
  (override with `CAP_SERVER_URL`), push presentation options.
- `mobile-shell/` — offline fallback page (shown only without connectivity).
- `src/components/native-bridge.tsx` — mounted in the root layout; on native
  it registers for push (FCM token → `POST /api/me/fcm-token`), routes
  `appUrlOpen` deep links, and opens `/dashboard` when a notification is
  tapped. No-op in regular browsers.
- "Use my current location" in the locations form uses
  `@capacitor/geolocation` on native (browser geolocation on the web) and
  reverse-geocodes server-side.

## Generating the native projects (run locally — needs Xcode / Android Studio)

```bash
npm install
CAP_SERVER_URL=https://your-deployment.vercel.app npx cap add ios
CAP_SERVER_URL=https://your-deployment.vercel.app npx cap add android
npx cap sync
```

Commit the generated `ios/` and `android/` directories.

## Push notifications (FCM)

Android:

1. In the Firebase console, add an Android app with package
   `com.brewpass.app` and download `google-services.json` into
   `android/app/`.

iOS:

1. Add an iOS app in Firebase (`com.brewpass.app`), download
   `GoogleService-Info.plist` into the Xcode project.
2. Upload your APNs auth key (p8) to Firebase Cloud Messaging settings.
3. Enable the Push Notifications capability + Background Modes → Remote
   notifications in Xcode.

The server side (firebase-admin) already sends to every token registered
via `/api/me/fcm-token`; dead tokens are pruned automatically.

## Deep links

- Android: add an `intent-filter` for `https://<your-domain>` in
  `android/app/src/main/AndroidManifest.xml` and host
  `/.well-known/assetlinks.json`.
- iOS: add the Associated Domains capability
  (`applinks:<your-domain>`) and host
  `/.well-known/apple-app-site-association`.

The in-app routing side (`appUrlOpen` → path) is already handled by the
native bridge.

## Store checklist

- App icons + splash screens: `npx @capacitor/assets generate` from a
  1024×1024 icon and 2732×2732 splash source.
- Screenshots: dashboard (upcoming order card), billing, onboarding.
- Privacy: the app collects name, email, phone, delivery addresses and
  precise location (only when the user taps "use my current location");
  payments are processed by Stripe.
- Android: signed AAB via Android Studio → Play Console.
- iOS: archive via Xcode → App Store Connect.

## Day-to-day workflow

```bash
# after web changes that affect the shell config or plugins:
npx cap sync
# open native IDEs:
npx cap open ios
npx cap open android
```
