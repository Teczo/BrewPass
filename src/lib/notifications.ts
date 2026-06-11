import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

import type { User } from "@/lib/models";

/**
 * Push (FCM) and email (Resend) delivery. Both are best-effort: when the
 * provider isn't configured the senders no-op with a log line, so the order
 * engine never fails because a notification channel is down.
 */

function isFcmConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY,
  );
}

let firebaseApp: App | undefined;

function getFirebaseApp(): App {
  if (!firebaseApp) {
    firebaseApp =
      getApps()[0] ??
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Vercel env vars store the key with literal \n sequences.
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
      });
  }
  return firebaseApp;
}

export interface PushResult {
  sent: number;
  /** Tokens FCM reported as dead — callers should prune them. */
  invalidTokens: string[];
}

export async function sendPushToUser(
  user: Pick<User, "fcmTokens">,
  message: { title: string; body: string },
): Promise<PushResult> {
  if (!isFcmConfigured() || user.fcmTokens.length === 0) {
    console.log(`Push skipped (configured=${isFcmConfigured()}): ${message.title}`);
    return { sent: 0, invalidTokens: [] };
  }

  const messaging = getMessaging(getFirebaseApp());
  const response = await messaging.sendEachForMulticast({
    tokens: user.fcmTokens,
    notification: message,
  });

  const invalidTokens: string[] = [];
  response.responses.forEach((result, index) => {
    if (result.error && result.error.code === "messaging/registration-token-not-registered") {
      invalidTokens.push(user.fcmTokens[index]);
    }
  });
  return { sent: response.successCount, invalidTokens };
}

/** Escape user-controlled strings before interpolating into email HTML. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Best-effort SMS via Twilio's REST API; no-ops when unconfigured. */
export async function sendSms(to: string, body: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) {
    console.log(`SMS skipped (Twilio not configured): ${body}`);
    return false;
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!response.ok) {
    console.error(`Twilio returned ${response.status}: ${await response.text()}`);
    return false;
  }
  return true;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`Email skipped (Resend not configured): ${args.subject}`);
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL ?? "BrewPass <onboarding@resend.dev>",
      to: [args.to],
      subject: args.subject,
      html: args.html,
    }),
  });
  if (!response.ok) {
    console.error(`Resend returned ${response.status}: ${await response.text()}`);
    return false;
  }
  return true;
}
