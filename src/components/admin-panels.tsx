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
  cafeName: string;
  status: string;
  deliverAt: string;
  failureReason: string | null;
}

export interface AdminCafeRow {
  id: string;
  name: string;
  address: string;
  capacityPerHour: number;
  active: boolean;
  staff: Array<{ sub: string; name: string }>;
  todayCount: number;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  isSelf: boolean;
}

const OVERRIDABLE = new Set(["scheduled", "confirmed", "preparing"]);
const REFUNDABLE = new Set(["confirmed", "preparing", "out_for_delivery", "delivered", "failed"]);

export function AdminOrdersTable({
  orders,
  cafes,
}: {
  orders: AdminOrderRow[];
  cafes: Array<{ id: string; name: string }>;
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
              <th className="py-2 pr-3">Café</th>
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
                <td className="py-2 pr-3">{order.cafeName}</td>
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
                                action: "reassign_cafe",
                                cafeId: e.target.value,
                              });
                            }
                          }}
                          className="rounded border border-neutral-300 px-1 py-1 text-xs"
                        >
                          <option value="">Reassign café…</option>
                          {cafes.map((cafe) => (
                            <option key={cafe.id} value={cafe.id}>
                              {cafe.name}
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

export function AdminCafes({ cafes }: { cafes: AdminCafeRow[] }) {
  const { run, busy, error } = useAdminAction();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [capacity, setCapacity] = useState(30);
  const [staffEmails, setStaffEmails] = useState<Record<string, string>>({});

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {cafes.map((cafe) => (
        <div key={cafe.id} className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">
                {cafe.name}{" "}
                {!cafe.active && (
                  <span className="rounded bg-neutral-100 px-1.5 text-xs text-neutral-500">
                    inactive
                  </span>
                )}
              </p>
              <p className="text-sm text-neutral-500">
                {cafe.address} · {cafe.capacityPerHour}/hr · {cafe.todayCount} orders today
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(`/api/admin/cafes/${cafe.id}`, "PATCH", { active: !cafe.active })}
              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
            >
              {cafe.active ? "Deactivate" : "Activate"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {cafe.staff.map((member) => (
              <span
                key={member.sub}
                className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs"
              >
                {member.name}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(`/api/admin/cafes/${cafe.id}`, "PATCH", { removeStaffSub: member.sub })
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
              value={staffEmails[cafe.id] ?? ""}
              onChange={(e) => setStaffEmails((prev) => ({ ...prev, [cafe.id]: e.target.value }))}
            />
            <button
              type="button"
              disabled={busy || !(staffEmails[cafe.id] ?? "").includes("@")}
              onClick={() => {
                run(`/api/admin/cafes/${cafe.id}`, "PATCH", {
                  addStaffEmail: staffEmails[cafe.id],
                });
                setStaffEmails((prev) => ({ ...prev, [cafe.id]: "" }));
              }}
              className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
            >
              Add staff
            </button>
          </div>
        </div>
      ))}

      <form
        className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-neutral-300 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          run("/api/admin/cafes", "POST", { name, address, capacityPerHour: capacity });
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
          Add café
        </button>
      </form>
    </div>
  );
}

const ROLES = ["individual", "corporate", "student", "cafe", "admin"];

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
          </li>
        ))}
      </ul>
    </div>
  );
}
