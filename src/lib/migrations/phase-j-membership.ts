import { ObjectId, type AnyBulkWriteOperation } from "mongodb";

import { corporateAccountsCollection, usersCollection } from "@/lib/collections";
import { getDb } from "@/lib/db";
import type { CorporateMembership, User, UserRole } from "@/lib/models";
import { newDocumentMeta } from "@/lib/models/shared";

/**
 * Phase J.0 migration — decouple corporate membership from `User.role`.
 *
 * Before J.0, adding a member rewrote their `role` to `corporate`, erasing
 * their personal identity, and "membership" lived only in the
 * `CorporateAccount.memberUserIds` array. This migration makes membership a
 * first-class relationship (`CorporateMembership`) and undoes the role
 * mutation, so a member keeps their personal role while also belonging to a
 * company (critical rule #16). Mirrors the Phase A/I discipline: both
 * directions exist and both are idempotent (critical rule #10).
 *
 * - `up`: for every `memberUserIds` entry, upsert an `active`
 *   `CorporateMembership` keyed (corporateAccountId, userId), then restore the
 *   personal role of any *member* still flagged `corporate` (owners excluded —
 *   billing-ownership is a separate concept). `memberUserIds` is left in place
 *   as a rollback backup and is still dual-written by the member flow until
 *   later Phase J steps retire seat billing.
 * - `down`: delete the memberships that correspond to current `memberUserIds`
 *   entries and re-flag those members `corporate`, restoring the pre-J.0 shape.
 *
 * The original personal role of a flipped member is unrecoverable (the old
 * code overwrote it), so `restoredRole` uses a documented heuristic:
 * `studentVerifiedAt` set ⇒ `student`, otherwise `individual`.
 */

/** Minimal member shape the role decision needs. */
export interface RoleRestoreInput {
  role: UserRole;
  studentVerifiedAt?: Date;
}

/**
 * Pure (unit-tested) decision: the personal role to restore for a member that
 * the old member-add flow flipped to `corporate`. The pre-flip role is lost,
 * so verified students go back to `student` and everyone else to `individual`.
 * Privileged roles (admin/vendor/cafe) and members that aren't `corporate` are
 * never touched — returns the role unchanged.
 */
export function restoredRole(user: RoleRestoreInput): UserRole {
  if (user.role !== "corporate") return user.role;
  return user.studentVerifiedAt ? "student" : "individual";
}

/**
 * Pure (unit-tested) builder for a migrated membership row. Legacy members
 * arrived via the owner's email-add flow, so `joinedVia` is `email`. Status is
 * `active` (they were live members) and `joinedAt` records the migration time.
 */
export function legacyMembershipDoc(
  corporateAccountId: ObjectId,
  userId: ObjectId,
  now: Date,
): CorporateMembership {
  return {
    _id: new ObjectId(),
    ...newDocumentMeta(),
    corporateAccountId,
    userId,
    status: "active",
    joinedVia: "email",
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export interface PhaseJMigrationSummary {
  direction: "up" | "down";
  /** up: membership rows inserted. down: membership rows deleted. */
  membershipsWritten: number;
  /** up only: (account, user) pairs that already had a membership (re-run). */
  membershipsSkipped: number;
  /** Members whose `role` was changed (up: restored to personal; down: re-flagged corporate). */
  rolesChanged: number;
}

export async function migratePhaseJUp(now: Date = new Date()): Promise<PhaseJMigrationSummary> {
  const [accounts, memberships, users] = await Promise.all([
    corporateAccountsCollection(),
    (await getDb()).collection<CorporateMembership>("corporateMemberships"),
    usersCollection(),
  ]);
  const summary: PhaseJMigrationSummary = {
    direction: "up",
    membershipsWritten: 0,
    membershipsSkipped: 0,
    rolesChanged: 0,
  };

  const accountDocs = await accounts.find({}).toArray();
  // Billing owners are excluded from role restoration: ownership is a separate
  // concept from membership, so this migration leaves their role alone.
  const ownerIds = new Set(accountDocs.map((a) => a.billingOwnerUserId.toHexString()));
  const memberIds = new Map<string, ObjectId>();

  for (const account of accountDocs) {
    for (const userId of account.memberUserIds) {
      memberIds.set(userId.toHexString(), userId);
      // $setOnInsert keyed on (account, user): re-runs never duplicate or
      // clobber a membership edited after the migration.
      const result = await memberships.updateOne(
        { corporateAccountId: account._id, userId },
        { $setOnInsert: legacyMembershipDoc(account._id, userId, now) },
        { upsert: true },
      );
      if (result.upsertedCount === 1) summary.membershipsWritten += 1;
      else summary.membershipsSkipped += 1;
    }
  }

  // Restore personal roles for members the old flow flipped to `corporate`
  // (owners excluded). Idempotent: members already on a personal role are
  // filtered out by the `role: "corporate"` query.
  const restoreCandidates = [...memberIds.values()].filter(
    (id) => !ownerIds.has(id.toHexString()),
  );
  if (restoreCandidates.length > 0) {
    const flipped = await users
      .find({ _id: { $in: restoreCandidates }, role: "corporate" })
      .toArray();
    const ops: AnyBulkWriteOperation<User>[] = flipped.map((u) => ({
      updateOne: {
        filter: { _id: u._id },
        update: { $set: { role: restoredRole(u), updatedAt: now } },
      },
    }));
    if (ops.length > 0) {
      await users.bulkWrite(ops, { ordered: false });
      summary.rolesChanged = ops.length;
    }
  }

  return summary;
}

export async function migratePhaseJDown(now: Date = new Date()): Promise<PhaseJMigrationSummary> {
  const [accounts, memberships, users] = await Promise.all([
    corporateAccountsCollection(),
    (await getDb()).collection<CorporateMembership>("corporateMemberships"),
    usersCollection(),
  ]);
  const summary: PhaseJMigrationSummary = {
    direction: "down",
    membershipsWritten: 0,
    membershipsSkipped: 0,
    rolesChanged: 0,
  };

  const accountDocs = await accounts.find({}).toArray();
  const ownerIds = new Set(accountDocs.map((a) => a.billingOwnerUserId.toHexString()));
  const memberIds = new Map<string, ObjectId>();

  for (const account of accountDocs) {
    for (const userId of account.memberUserIds) {
      memberIds.set(userId.toHexString(), userId);
      const result = await memberships.deleteOne({
        corporateAccountId: account._id,
        userId,
      });
      summary.membershipsWritten += result.deletedCount;
    }
  }

  // Re-flag members `corporate`, mirroring the pre-J.0 behavior. Owners are
  // left alone for the same reason as `up`.
  const reflag = [...memberIds.values()].filter((id) => !ownerIds.has(id.toHexString()));
  if (reflag.length > 0) {
    const result = await users.updateMany(
      { _id: { $in: reflag }, role: { $nin: ["admin", "vendor", "cafe", "corporate"] } },
      { $set: { role: "corporate", updatedAt: now } },
    );
    summary.rolesChanged = result.modifiedCount;
  }

  return summary;
}
