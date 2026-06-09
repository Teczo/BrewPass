import { ObjectId } from "mongodb";

import { getSession } from "@/lib/auth0";
import { locationsCollection, preferencesCollection, usersCollection } from "@/lib/collections";
import type { User } from "@/lib/models";

/**
 * Resolve the logged-in Auth0 session to our User document, creating it on
 * first login (seeded from the ID token claims). Returns null when there is
 * no session — callers decide whether that means redirect or 401.
 */
export async function getOrCreateCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;

  const { sub, email, name } = session.user;
  const users = await usersCollection();

  const now = new Date();
  const result = await users.findOneAndUpdate(
    { authSub: sub },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        authSub: sub,
        name: name ?? "",
        email: email ?? "",
        role: "individual",
        fcmTokens: [],
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  return result;
}

export interface OnboardingStatus {
  profileComplete: boolean;
  hasLocation: boolean;
  hasPreference: boolean;
  completed: boolean;
}

export async function getOnboardingStatus(user: User): Promise<OnboardingStatus> {
  const [locations, preferences] = await Promise.all([
    locationsCollection(),
    preferencesCollection(),
  ]);
  const [locationCount, preference] = await Promise.all([
    locations.countDocuments({ userId: user._id }),
    preferences.findOne({ userId: user._id }),
  ]);

  return {
    profileComplete: user.name.length > 0 && Boolean(user.phone),
    hasLocation: locationCount > 0,
    hasPreference: preference !== null,
    completed: Boolean(user.onboardingCompletedAt),
  };
}
