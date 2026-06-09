import { z } from "zod";

import { baseDocumentSchema } from "@/lib/models/shared";

export const userRoleSchema = z.enum(["individual", "corporate", "student", "admin"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userSchema = baseDocumentSchema.extend({
  /** Auth0 subject claim — the canonical identity link. */
  authSub: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1).optional(),
  role: userRoleSchema,
  /** FCM device registration tokens for push notifications. */
  fcmTokens: z.array(z.string()),
  /** Set when the user finishes the onboarding flow (profile → locations → preferences). */
  onboardingCompletedAt: z.date().optional(),
});
export type User = z.infer<typeof userSchema>;
