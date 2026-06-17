import { NextResponse } from "next/server";

import { authenticateV1 } from "@/lib/v1/http";
import { v1User } from "@/lib/v1/serializers";

export const runtime = "nodejs";

/** The authenticated subscriber (Phase I.4). */
export async function GET() {
  const auth = await authenticateV1();
  if ("response" in auth) return auth.response;

  return NextResponse.json({ user: v1User(auth.user) });
}
