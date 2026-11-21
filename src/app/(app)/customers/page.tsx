import type { Metadata } from "next";
import Link from "next/link";
import { Pencil, Search, SearchX, Users } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import BalancePill from "@/components/BalancePill";
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
import { getMyBusiness } from "@/lib/business";
import { regionOf } from "@/lib/region";
import { canViewPage, getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { formatMoney, toCents } from "@/lib/money";
import {
  AddCustomerForm,
  CustomerActiveToggle,
  EditCustomerForm,
} from "@/app/(app)/customers/CustomerForms";

export const metadata: Metadata = {
  title: "Customers",
};

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  trn: string | null;
  is_active: boolean;
};

type Filters = { q: string; status: string };

const PAGE_SIZE = 200;
const CUSTOMER_COLUMNS = "id, name, phone, address, notes, trn, is_active";

function pageHref(filters: Partial<Filters> & { edit?: string }) {
  const search = new URLSearchParams();
  if (filters.q) search.set("q", filters.q);
  if (filters.status && filters.status !== "active") search.set("status", filters.status);
  if (filters.edit) search.set("edit", filters.edit);
  const text = search.toString();
  return text ? `/customers?${text}` : "/customers";
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; edit?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "customers")) {
    return <AccessDenied />;
  }
  const canCreate = hasAny(permissions, ["customers.create", "customers.manage"]);
  const canManage = permissions.includes("customers.manage");

  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 100);
  const status =
    params.status === "inactive" || params.status === "all" ? params.status : "active";
  const editId = canManage && UUID_PATTERN.test(params.edit ?? "") ? params.edit! : "";
  const filters: Filters = { q, status };

  const supabase = await createClient();

  let query = supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .is("deleted_at", null)
    .order("name")
    .limit(PAGE_SIZE);
  const cleaned = q.replace(/[%_,()\\*]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned) query = query.or(`name.ilike.%${cleaned}%,phone.ilike.%${cleaned}%`);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);

  const [{ data, error }, { data: balanceData }, business] = await Promise.all([
    query,
    // What each customer owes us
    supabase.from("customer_balances").select("customer_id, balance"),
    getMyBusiness(),
  ]);
  const customers = (data ?? []) as CustomerRow[];
  const filtering = Boolean(cleaned || status !== "active");
  const currency = business?.currency_code || "PKR";

  const balances = new Map<string, bigint>();
  let totalReceivable = BigInt(0);
  for (const row of (balanceData ?? []) as { customer_id: string; balance: number | string | null }[]) {
    const cents = toCents(row.balance) ?? BigInt(0);
    balances.set(row.customer_id, cents);
    if (cents > BigInt(0)) totalReceivable += cents;
  }
  const balanceOf = (id: string) => balances.get(id) ?? BigInt(0);

  let editing: CustomerRow | null = null;
  if (editId) {
    const { data: editData } = await supabase
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .eq("id", editId)
      .maybeSingle();
    editing = (editData as CustomerRow | null) ?? null;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={Users}
        title="Customers"
        description="Your customers and how much each one owes."
      />

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-peach px-5 py-4">
        <div>
          <p className="text-sm font-medium text-ink">Total receivable</p>
          <p className="text-xs text-ink-muted">What all customers owe us together</p>
        </div>
        <p className="text-2xl font-bold text-ink">{formatMoney(totalReceivable, currency)}</p>
      </section>

      {canCreate && <AddCustomerForm region={regionOf(business)} />}

      {editing && (
        <section className={cardClass}>
          <h2 className="mb-4 text-base font-bold text-ink">Edit &quot;{editing.name}&quot;</h2>
          <EditCustomerForm
            key={editing.id}
            region={regionOf(business)}
            customer={{
              id: editing.id,
              name: editing.name,
              phone: editing.phone ?? "",
              address: editing.address ?? "",
              notes: editing.notes ?? "",
              trn: editing.trn ?? "",
            }}
            cancelHref={pageHref(filters)}
          />
        </section>
      )}

      {/* Search and filters */}
      <section className={cardClass}>
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="customer-q" className={labelClass}>
              Search by name or phone
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input
                id="customer-q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Search customers..."
                className={inputClass + " pl-10"}
              />
            </div>
          </div>
          <div className="sm:w-44">
            <label htmlFor="customer-status" className={labelClass}>
              Status
            </label>
            <select id="customer-status" name="status" defaultValue={status} className={inputClass}>
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
              <Link href="/customers" className={secondaryButtonClass + " flex-1 sm:flex-none"}>
                Clear
              </Link>
            )}
          </div>
        </form>
      </section>

      {error ? (
        <Notice kind="error">Could not load customers: {error.message}</Notice>
      ) : customers.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={SearchX}
            title="No customers match your search"
            text="Try a different name, phone or status."
            action={
              <Link href="/customers" className={secondaryButtonClass}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No customers yet"
            text="Customers are added here or automatically when a sale has a new name and phone."
          />
        )
      ) : (
        <section aria-label="Customers" className="space-y-3">
          <p className="text-sm text-ink-muted">
            {customers.length} {customers.length === 1 ? "customer" : "customers"}
            {customers.length === PAGE_SIZE &&
              ` (only the first ${PAGE_SIZE} are shown; narrow your search)`}
          </p>

          {/* Phone: tappable cards */}
          <ul className="space-y-3 md:hidden">
            {customers.map((customer) => (
              <li key={customer.id} className={cardClass + " relative"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="font-semibold text-ink after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:ring-4 focus-visible:after:ring-accent/20"
                    >
                      {customer.name}
                    </Link>
                    <p className="mt-0.5 text-sm text-ink-muted">{customer.phone ?? "—"}</p>
                    <p className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
                      Balance (they owe)
                      <BalancePill value={balanceOf(customer.id)} currency={currency} />
                    </p>
                  </div>
                  <StatusPill active={customer.is_active} />
                </div>
                {canManage && (
                  <div className="relative z-10 mt-4 flex flex-wrap justify-end gap-2">
                    <Link
                      href={pageHref({ ...filters, edit: customer.id })}
                      className={secondaryButtonClass + " px-4 text-xs"}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Link>
                    <CustomerActiveToggle id={customer.id} active={customer.is_active} />
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Tablet and laptop: table with clickable rows */}
          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3 text-right">Balance (they owe)</th>
                  <th className="px-5 py-3">Status</th>
                  {canManage && (
                    <th className="px-5 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr
                    key={customer.id}
                    className="relative border-b border-line last:border-0 hover:bg-surface-muted focus-within:bg-surface-muted"
                  >
                    <td className="px-5 py-3 font-semibold text-ink">
                      {/* The link covers the row; the action buttons sit above it */}
                      <Link
                        href={`/customers/${customer.id}`}
                        className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                      >
                        {customer.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-ink-muted">{customer.phone ?? "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <BalancePill value={balanceOf(customer.id)} currency={currency} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill active={customer.is_active} />
                    </td>
                    {canManage && (
                      <td className="px-5 py-3">
                        <div className="relative z-10 flex items-start justify-end gap-2">
                          <Link
                            href={pageHref({ ...filters, edit: customer.id })}
                            className={secondaryButtonClass + " px-4 text-xs"}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Link>
                          <CustomerActiveToggle id={customer.id} active={customer.is_active} />
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
