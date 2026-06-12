import { redirect } from "next/navigation";

/** The v1 café portal lives at /vendor since the v2 marketplace. */
export default function LegacyCafePortalPage() {
  redirect("/vendor");
}
