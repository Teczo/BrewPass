import type { Location, Preference, User } from "@/lib/models";

/** JSON-safe shapes sent to the client (ObjectIds and Dates stringified). */

export function userToJson(user: User) {
  return {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    role: user.role,
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
  };
}

export function locationToJson(location: Location) {
  return {
    id: location._id.toHexString(),
    label: location.label,
    address: location.address,
    geo: location.geo,
    notes: location.notes ?? null,
  };
}

export function preferenceToJson(preference: Preference) {
  return {
    id: preference._id.toHexString(),
    defaultDrink: preference.defaultDrink,
    schedule: preference.schedule,
    defaultLocationId: preference.defaultLocationId.toHexString(),
  };
}

export type UserJson = ReturnType<typeof userToJson>;
export type LocationJson = ReturnType<typeof locationToJson>;
export type PreferenceJson = ReturnType<typeof preferenceToJson>;
