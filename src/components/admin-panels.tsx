"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Shared fetch-and-refresh helper for all admin mutations. */
function useAdminAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(url: string, method: string, payload: object) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Action failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}

export interface AdminOrderRow {
  id: string;
  customerName: string;
  drink: string;
  locationLabel: string;
  vendorName: string;
  status: string;
  deliverAt: string;
  failureReason: string | null;
  /** Phase H money state. */
  chargeStatus: string | null;
  payoutStatus: string | null;
}

export interface AdminVendorRow {
  id: string;
  name: string;
  address: string;
  capacityPerHour: number;
  status: string;
  reviewNote: string | null;
  staff: Array<{ sub: string; name: string }>;
  todayCount: number;
  /** Phase H/G quality + commission. */
  ratingScore: number | null;
  ratingCount: number;
  acceptanceRate: number | null;
  onTimeRate: number | null;
  qualitySuspended: boolean;
  qualityFlagReason: string | null;
  commissionOverrideBps: number | null;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isSelf: boolean;
  studentVerified: boolean;
}

const OVERRIDABLE = new Set(["scheduled", "confirmed", "preparing"]);
const REFUNDABLE = new Set(["confirmed", "preparing", "out_for_delivery", "delivered", "failed"]);

export function AdminOrdersTable({
  orders,
  vendors,
}: {
  orders: AdminOrderRow[];
  vendors: Array<{ id: string; name: string }>;
}) {
  const { run, busy, error } = useAdminAction();

  if (orders.length === 0) {
    return <p className="text-sm text-neutral-400">No orders today yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs text-neutral-400 uppercase">
              <th className="py-2 pr-3">Time</th>
              <th className="py-2 pr-3">Customer</th>
              <th className="py-2 pr-3">Drink</th>
              <th className="py-2 pr-3">Vendor</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-neutral-100 align-top">
                <td className="py-2 pr-3 whitespace-nowrap">
                  {new Date(order.deliverAt).toLocaleString("en-MY", {
                    timeZone: "Asia/Kuala_Lumpur",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </td>
                <td className="py-2 pr-3">{order.customerName}</td>
                <td className="py-2 pr-3">
                  {order.drink} → {order.locationLabel}
                </td>
                <td className="py-2 pr-3">{order.vendorName}</td>
                <td className="py-2 pr-3">
                  {order.status}
                  {order.failureReason && (
                    <span className="block text-xs text-red-600">{order.failureReason}</span>
                  )}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {OVERRIDABLE.has(order.status) && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(`/api/admin/orders/${order.id}`, "POST", {
                              action: "force_skip",
                            })
                          }
                          className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                        >
                          Force-skip
                        </button>
                        <select
                          disabled={busy}
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              run(`/api/admin/orders/${order.id}`, "POST", {
                                action: "reassign_vendor",
                                vendorId: e.target.value,
                              });
                            }
                          }}
                          className="rounded border border-neutral-300 px-1 py-1 text-xs"
                        >
                          <option value="">Reassign vendor…</option>
                          {vendors.map((vendor) => (
                            <option key={vendor.id} value={vendor.id}>
                              {vendor.name}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    {REFUNDABLE.has(order.status) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(`/api/admin/orders/${order.id}`, "POST", {
                            action: "refund_quota",
                          })
                        }
                        className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
                      >
                        Refund quota
                      </button>
                    )}
                    {order.chargeStatus === "charged" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm("Refund this charge to the customer's card?")) {
                            run(`/api/admin/orders/${order.id}`, "POST", {
                              action: "refund_charge",
                            });
                          }
                        }}
                        className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Refund money
                      </button>
                    )}
                    {order.chargeStatus === "refunded" && (
                      <span className="text-xs text-neutral-400">refunded</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Statuses an admin can set directly; applications use the review flow. */
const ADMIN_STATUSES = ["active", "paused", "suspended", "offline"];

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  rejected: "bg-red-100 text-red-700",
  active: "bg-green-100 text-green-800",
  paused: "bg-neutral-100 text-neutral-500",
  suspended: "bg-red-100 text-red-700",
  offline: "bg-neutral-100 text-neutral-500",
};

function pct(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

export function AdminVendors({
  vendors,
  platformDefaultBps,
}: {
  vendors: AdminVendorRow[];
  platformDefaultBps: number;
}) {
  const { run, busy, error } = useAdminAction();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [capacity, setCapacity] = useState(30);
  const [staffEmails, setStaffEmails] = useState<Record<string, string>>({});
  const [commission, setCommission] = useState<Record<string, string>>({});

  // Applications first, then everyone else.
  const sorted = [...vendors].sort(
    (a, b) => Number(b.status === "pending") - Number(a.status === "pending"),
  );

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {sorted.map((vendor) => (
        <div
          key={vendor.id}
          className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-medium">
                {vendor.name}{" "}
                <span
                  className={`rounded px-1.5 text-xs ${STATUS_BADGE[vendor.status] ?? "bg-neutral-100"}`}
                >
                  {vendor.status}
                </span>
              </p>
              <p className="text-sm text-neutral-500">
                {vendor.address} · {vendor.capacityPerHour}/hr · {vendor.todayCount} orders today
              </p>
              {vendor.status === "rejected" && vendor.reviewNote && (
                <p className="text-xs text-red-600">Rejected: {vendor.reviewNote}</p>
              )}
            </div>
            {vendor.status === "pending" ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(`/api/admin/vendors/${vendor.id}/review`, "POST", { action: "approve" })
                  }
                  className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const note = window.prompt("Why is this application rejected?");
                    if (note?.trim()) {
                      run(`/api/admin/vendors/${vendor.id}/review`, "POST", {
                        action: "reject",
                        note: note.trim(),
                      });
                    }
                  }}
                  className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            ) : (
              vendor.status !== "rejected" && (
                <select
                  disabled={busy}
                  value={vendor.status}
                  onChange={(e) =>
                    run(`/api/admin/vendors/${vendor.id}`, "PATCH", { status: e.target.value })
                  }
                  className="rounded border border-neutral-300 px-1 py-1 text-xs"
                >
                  {ADMIN_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              )
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {vendor.staff.map((member) => (
              <span
                key={member.sub}
                className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs"
              >
                {member.name}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(`/api/admin/vendors/${vendor.id}`, "PATCH", { removeStaffSub: member.sub })
                  }
                  className="text-neutral-400 hover:text-red-600"
                  aria-label={`Remove ${member.name}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              className="rounded border border-neutral-300 px-2 py-1 text-xs"
              placeholder="staff@email.com"
              value={staffEmails[vendor.id] ?? ""}
              onChange={(e) => setStaffEmails((prev) => ({ ...prev, [vendor.id]: e.target.value }))}
            />
            <button
              type="button"
              disabled={busy || !(staffEmails[vendor.id] ?? "").includes("@")}
              onClick={() => {
                run(`/api/admin/vendors/${vendor.id}`, "PATCH", {
                  addStaffEmail: staffEmails[vendor.id],
                });
                setStaffEmails((prev) => ({ ...prev, [vendor.id]: "" }));
              }}
              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
            >
              Add staff
            </button>
          </div>

          {/* Phase G/H: quality + commission */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-neutral-100 pt-2 text-xs text-neutral-600">
            <span>
              {vendor.ratingScore != null ? `${vendor.ratingScore.toFixed(1)}★` : "—"} (
              {vendor.ratingCount})
            </span>
            <span>accept {pct(vendor.acceptanceRate)}</span>
            <span>on-time {pct(vendor.onTimeRate)}</span>
            {vendor.qualitySuspended && (
              <span className="flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">
                quality-suspended ({vendor.qualityFlagReason ?? "?"})
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(`/api/admin/vendors/${vendor.id}`, "PATCH", { clearQualityFlag: true })
                  }
                  className="underline hover:no-underline"
                >
                  clear
                </button>
              </span>
            )}
            <span className="ml-auto flex items-center gap-1">
              Commission
              <input
                type="number"
                min={0}
                max={100}
                placeholder={`${platformDefaultBps / 100}`}
                value={commission[vendor.id] ?? ""}
                onChange={(e) =>
                  setCommission((prev) => ({ ...prev, [vendor.id]: e.target.value }))
                }
                className="w-16 rounded border border-neutral-300 px-1 py-0.5"
              />
              %
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const raw = commission[vendor.id];
                  const bps =
                    raw == null || raw.trim() === "" ? null : Math.round(Number(raw) * 100);
                  run(`/api/admin/vendors/${vendor.id}`, "PATCH", {
                    commissionRateOverrideBps: bps,
                  });
                  setCommission((prev) => ({ ...prev, [vendor.id]: "" }));
                }}
                className="rounded border border-neutral-300 px-1.5 py-0.5 hover:bg-neutral-50 disabled:opacity-50"
              >
                {vendor.commissionOverrideBps != null
                  ? `set (now ${vendor.commissionOverrideBps / 100}%)`
                  : "set"}
              </button>
            </span>
          </div>
        </div>
      ))}

      <form
        className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-neutral-300 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          run("/api/admin/vendors", "POST", {
            businessName: name,
            address,
            capacityPerHour: capacity,
          });
          setName("");
          setAddress("");
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-medium">
          Name
          <input
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs font-medium">
          Address
          <input
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Capacity/hr
          <input
            type="number"
            min={1}
            className="w-24 rounded border border-neutral-300 px-2 py-1.5 text-sm"
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-amber-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          Add vendor
        </button>
      </form>
    </div>
  );
}

export function CommissionPanel({
  defaultRateBps,
  codeDefaultBps,
}: {
  defaultRateBps: number;
  codeDefaultBps: number;
}) {
  const { run, busy, error } = useAdminAction();
  const [value, setValue] = useState((defaultRateBps / 100).toString());

  return (
    <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="font-medium">Platform commission</p>
          <p className="text-xs text-neutral-500">
            Default retained on every order. Per-vendor overrides are set in the vendor list. Code
            fallback {codeDefaultBps / 100}%.
          </p>
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24 rounded border border-neutral-300 px-2 py-1"
          />
          %
          <button
            type="button"
            disabled={busy || value.trim() === ""}
            onClick={() =>
              run("/api/admin/commission", "PUT", {
                defaultRateBps: Math.round(Number(value) * 100),
              })
            }
            className="rounded-md bg-amber-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Save
          </button>
        </label>
      </div>
    </div>
  );
}

const ROLES = ["individual", "corporate", "student", "cafe", "vendor", "admin"];

export function AdminUsers({ users }: { users: AdminUserRow[] }) {
  const { run, busy, error } = useAdminAction();
  const [query, setQuery] = useState("");

  const filtered = users.filter(
    (user) =>
      user.name.toLowerCase().includes(query.toLowerCase()) ||
      user.email.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <input
        className="max-w-sm rounded border border-neutral-300 px-2 py-1.5 text-sm"
        placeholder="Search name or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="flex flex-col">
        {filtered.map((user) => (
          <li
            key={user.id}
            className="flex items-center justify-between border-b border-neutral-100 py-2 text-sm"
          >
            <span>
              <span className="font-medium">{user.name || "(no name)"}</span>{" "}
              <span className="text-neutral-500">{user.email}</span>
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(`/api/admin/users/${user.id}`, "PATCH", {
                    studentVerified: !user.studentVerified,
                  })
                }
                className={`rounded px-2 py-0.5 text-xs ${
                  user.studentVerified
                    ? "bg-green-100 text-green-800"
                    : "border border-neutral-300 text-neutral-500 hover:bg-neutral-50"
                }`}
                title="Toggle student verification"
              >
                {user.studentVerified ? "Student ✓" : "Verify student"}
              </button>
              {user.isSelf ? (
                <span className="text-xs text-neutral-400">you · {user.role}</span>
              ) : (
                <select
                  disabled={busy}
                  value={user.role}
                  onChange={(e) =>
                    run(`/api/admin/users/${user.id}`, "PATCH", { role: e.target.value })
                  }
                  className="rounded border border-neutral-300 px-1 py-1 text-xs"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
