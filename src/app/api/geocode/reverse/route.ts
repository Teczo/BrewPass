import { NextResponse } from "next/server";
import { z } from "zod";

import { reverseGeocode } from "@/lib/geocode";
import { getOrCreateCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

const inputSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Coordinates → address for the "use my current location" flow. */
export async function POST(request: Request) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const address = await reverseGeocode(parsed.data);
  if (!address) {
    return NextResponse.json({ error: "Could not resolve your location" }, { status: 422 });
  }
  return NextResponse.json({ address });
}
