import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { webhookSubscriptionsCollection } from "@/lib/collections";
import { newDocumentMeta, webhookEventTypeSchema } from "@/lib/models";
import { webhookSubscriptionToJson } from "@/lib/serializers";
import { generateWebhookSecret } from "@/lib/webhooks/signing";

export const runtime = "nodejs";

const createSchema = z.object({
  url: z.string().url(),
  // Empty (or omitted) = subscribe to every event type.
  eventTypes: z.array(webhookEventTypeSchema).default([]),
  description: z.string().trim().max(200).optional(),
});

/** List outbound-webhook subscriptions (Phase I.5). */
export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const subscriptions = await webhookSubscriptionsCollection();
  const docs = await subscriptions.find({}).sort({ createdAt: -1 }).toArray();
  return NextResponse.json({ subscriptions: docs.map(webhookSubscriptionToJson) });
}

/**
 * Register a new endpoint. The generated signing secret is returned in full
 * exactly once (here) — afterwards only a preview is ever shown.
 */
export async function POST(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const now = new Date();
  const secret = generateWebhookSecret();
  const subscriptions = await webhookSubscriptionsCollection();
  const doc = {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    url: parsed.data.url,
    secret,
    eventTypes: parsed.data.eventTypes,
    active: true,
    ...(parsed.data.description ? { description: parsed.data.description } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await subscriptions.insertOne(doc);

  // Return the full secret once so the operator can configure their receiver.
  return NextResponse.json(
    { subscription: webhookSubscriptionToJson(doc), secret },
    { status: 201 },
  );
}
