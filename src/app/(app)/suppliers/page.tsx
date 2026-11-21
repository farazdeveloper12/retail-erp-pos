import type { Metadata } from "next";
import Link from "next/link";
import { Pencil, Search, SearchX, Truck } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import {
  EmptyState,
  Notice,
  PageHeader,
  StatusPill,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canViewPage, getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { getMyBusiness } from "@/lib/business";
import { formatMoney, toCents } from "@/lib/money";
import BalancePill from "@/components/BalancePill";
import {
  EditSupplierForm,
  QuickAddSupplierForm,
  QuickFindSupplier,
  SupplierActiveToggle,
} from "@/app/(app)/suppliers/SupplierForms";

export const metadata: Metadata = {
  title: "Suppliers",
};

type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
};

type Filters = { q: string; status: string };

const PAGE_SIZE = 200;
const SUPPLIER_COLUMNS = "id, name, phone, address, notes, is_active, created_at";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

// Builds a suppliers link that keeps the other filters
function pageHref(filters: Partial<Filters> & { edit?: string }) {
  const search = new URLSearchParams();
  if (filters.q) search.set("q", filters.q);
  if (filters.status && filters.status !== "active") {
    search.set("status", filters.status);
  }
  if (filters.edit) search.set("edit", filters.edit);
  const text = search.toString();
  return text ? `/suppliers?${text}` : "/suppliers";
}


export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; edit?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "suppliers")) {
    return <AccessDenied />;
  }
  const canCreate = hasAny(permissions, ["suppliers.manage", "purchases.manage"]);
  const canManage = permissions.includes("suppliers.manage");

  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 100);
  const status =
    params.status === "inactive" || params.status === "all"
      ? params.status
      : "active";
  const editId =
    canManage && UUID_PATTERN.test(params.edit ?? "") ? params.edit! : "";
  const filters: Filters = { q, status };

  const supabase = await createClient();

  let query = supabase
    .from("suppliers")
    .select(SUPPLIER_COLUMNS)
    .is("deleted_at", null)
    .order("name")
    .limit(PAGE_SIZE);

  const cleaned = q.replace(/[%_,()\\*]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned) query = query.ilike("name", `%${cleaned}%`);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);

  const [{ data, error }, { data: balanceData }, business] = await Promise.all([
    query,
    // What we owe each supplier
    supabase.from("supplier_balances").select("supplier_id, balance"),
    getMyBusiness(),
  ]);
  const suppliers = (data ?? []) as SupplierRow[];
  const filtering = Boolean(cleaned || status !== "active");
  const currency = business?.currency_code || "PKR";

  const balances = new Map<string, bigint>();
  let totalPayable = BigInt(0);
  for (const row of (balanceData ?? []) as { supplier_id: string; balance: number | string | null }[]) {
    const cents = toCents(row.balance) ?? BigInt(0);
    balances.set(row.supplier_id, cents);
    if (cents > BigInt(0)) totalPayable += cents;
  }
  const balanceOf = (id: string) => balances.get(id) ?? BigInt(0);

  let editing: SupplierRow | null = null;
  if (editId) {
    const { data: editData } = await supabase
      .from("suppliers")
      .select(SUPPLIER_COLUMNS)
      .eq("id", editId)
      .maybeSingle();
    editing = (editData as SupplierRow | null) ?? null;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={Truck}
        title="Suppliers"
        description="The people and companies you buy stock from."
      />

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-peach px-5 py-4">
        <div>
          <p className="text-sm font-medium text-ink">Total payable</p>
          <p className="text-xs text-ink-muted">What we owe all suppliers together</p>
        </div>
        <p className="text-2xl font-bold text-ink">{formatMoney(totalPayable, currency)}</p>
      </section>

      {canCreate && <QuickAddSupplierForm />}

      {editing && (
        <section className={cardClass}>
          <h2 className="mb-4 text-base font-bold text-ink">
            Edit &quot;{editing.name}&quot;
          </h2>
          <EditSupplierForm
            key={editing.id}
            supplier={{
              id: editing.id,
              name: editing.name,
              phone: editing.phone ?? "",
              address: editing.address ?? "",
              notes: editing.notes ?? "",
            }}
            cancelHref={pageHref(filters)}
          />
        </section>
      )}

      {/* Search and filters */}
      <section className={cardClass + " space-y-4"}>
        <div>
          <p className={labelClass}>Quick find</p>
          <QuickFindSupplier canCreate={canCreate} />
        </div>

        <form
          method="get"
          className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <label htmlFor="supplier-q" className={labelClass}>
              Filter by name
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input
                id="supplier-q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Search suppliers..."
                className={inputClass + " pl-10"}
              />
            </div>
          </div>
          <div className="sm:w-44">
            <label htmlFor="supplier-status" className={labelClass}>
              Status
            </label>
            <select
              id="supplier-status"
              name="status"
              defaultValue={status}
              className={inputClass}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={primaryButtonClass + " flex-1 sm:flex-none"}>
              Search
            </button>
            {filtering && (
              <Link href="/suppliers" className={secondaryButtonClass + " flex-1 sm:flex-none"}>
                Clear
              </Link>
            )}
          </div>
        </form>
      </section>

      {/* Supplier list */}
      {error ? (
        <Notice kind="error">Could not load suppliers: {error.message}</Notice>
      ) : suppliers.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={SearchX}
            title="No suppliers match your filters"
            text="Try a different name or status."
            action={
              <Link href="/suppliers" className={secondaryButtonClass}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={Truck}
            title="No suppliers yet"
            text={
              canCreate
                ? "Use Quick add above to add your first supplier. Press Enter after each name."
                : "Suppliers will appear here once they are added."
            }
          />
        )
      ) : (
        <section aria-label="Suppliers" className="space-y-3">
          <p className="text-sm text-ink-muted">
            {suppliers.length} {suppliers.length === 1 ? "supplier" : "suppliers"}
            {suppliers.length === PAGE_SIZE &&
              ` (only the first ${PAGE_SIZE} are shown; narrow your search)`}
          </p>

          {/* Phone: cards */}
          <ul className="space-y-3 md:hidden">
            {suppliers.map((supplier) => (
              <li key={supplier.id} className={cardClass + " relative"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* The link covers the card; the buttons below sit above it */}
                    <Link
                      href={`/suppliers/${supplier.id}`}
                      className="font-semibold text-ink after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:ring-4 focus-visible:after:ring-accent/20"
                    >
                      {supplier.name}
                    </Link>
                    {supplier.phone && (
                      <p className="mt-0.5 text-sm text-ink-muted">
                        {supplier.phone}
                      </p>
                    )}
                    {supplier.address && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">
                        {supplier.address}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-ink-muted">
                      Added {formatDate(supplier.created_at)}
                    </p>
                    <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                      Balance (we owe)
                      <BalancePill value={balanceOf(supplier.id)} currency={currency} />
                    </p>
                  </div>
                  <StatusPill active={supplier.is_active} />
                </div>
                {canManage && (
                  <div className="relative z-10 mt-4 flex flex-wrap justify-end gap-2">
                    <Link
                      href={pageHref({ ...filters, edit: supplier.id })}
                      className={secondaryButtonClass + " px-4 text-xs"}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Link>
                    <SupplierActiveToggle
                      id={supplier.id}
                      active={supplier.is_active}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Tablet and laptop: table */}
          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Address</th>
                  <th className="px-5 py-3">Added</th>
                  <th className="px-5 py-3 text-right">Balance (we owe)</th>
                  <th className="px-5 py-3">Status</th>
                  {canManage && (
                    <th className="px-5 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr
                    key={supplier.id}
                    className="relative border-b border-line last:border-0 hover:bg-surface-muted focus-within:bg-surface-muted"
                  >
                    <td className="px-5 py-3 font-semibold text-ink">
                      {/* The link covers the row; the action buttons sit above it */}
                      <Link
                        href={`/suppliers/${supplier.id}`}
                        className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                      >
                        {supplier.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-ink-muted">
                      {supplier.phone ?? "—"}
                    </td>
                    <td className="max-w-xs truncate px-5 py-3 text-ink-muted">
                      {supplier.address ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-ink-muted">
                      {formatDate(supplier.created_at)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <BalancePill value={balanceOf(supplier.id)} currency={currency} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill active={supplier.is_active} />
                    </td>
                    {canManage && (
                      <td className="px-5 py-3">
                        <div className="relative z-10 flex items-start justify-end gap-2">
                          <Link
                            href={pageHref({ ...filters, edit: supplier.id })}
                            className={secondaryButtonClass + " px-4 text-xs"}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Link>
                          <SupplierActiveToggle
                            id={supplier.id}
                            active={supplier.is_active}
                          />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
