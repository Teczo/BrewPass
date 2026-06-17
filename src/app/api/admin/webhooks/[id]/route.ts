import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentAdmin } from "@/lib/admin";
import { webhookSubscriptionsCollection } from "@/lib/collections";
import { webhookEventTypeSchema } from "@/lib/models";
import { webhookSubscriptionToJson } from "@/lib/serializers";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const updateSchema = z
  .object({
    url: z.string().url().optional(),
    eventTypes: z.array(webhookEventTypeSchema).optional(),
    active: z.boolean().optional(),
    description: z.string().trim().max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No fields to update" });

/** Update a subscription (pause/resume, change url, retarget event types). */
export async function PATCH(request: Request, context: RouteContext) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const subscriptions = await webhookSubscriptionsCollection();
  const updated = await subscriptions.findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { ...parsed.data, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ subscription: webhookSubscriptionToJson(updated) });
}

/** Delete a subscription (stops future emission to it). */
export async function DELETE(_request: Request, context: RouteContext) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const subscriptions = await webhookSubscriptionsCollection();
  const result = await subscriptions.deleteOne({ _id: new ObjectId(id) });
  if (result.deletedCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
