import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, EmptyState, Notice, PageHeader, Pill, cardClass, inputClass, labelClass, secondaryButtonClass } from "@/components/ui";
import { describeChange, type ChangeRow } from "@/components/entries/EntryHistory";
import { createClient } from "@/lib/supabase/server";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { getBusinessTimeZone } from "@/lib/business";

export const metadata: Metadata = {
  title: "Edit & delete history",
};

const TYPE_LABELS: Record<string, string> = {
  sale: "Invoice",
  purchase: "Purchase",
  expense: "Expense",
  customer_payment: "Customer payment",
  supplier_payment: "Supplier payment",
  customer_purchase: "Phone from customer",
  customer: "Customer",
  supplier: "Supplier",
};

function entryHref(row: ChangeRow): string | null {
  switch (row.entity_type) {
    case "sale":
      return `/sales/${row.entity_id}`;
    case "purchase":
      return `/purchases/${row.entity_id}`;
    case "customer_purchase":
      return `/purchases/from-customers/${row.entity_id}`;
    case "customer":
      return `/customers/${row.entity_id}`;
    case "supplier":
      return `/suppliers/${row.entity_id}`;
    case "expense":
      return "/expenses";
    default:
      return null;
  }
}

// Every edit and delete with who, when, what changed and why.
// Deleted entries are hidden from the normal lists but listed here.
export default async function EntryHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; action?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "settings")) return <AccessDenied />;
  const { type: typeParam, action: actionParam } = await searchParams;
  const type = typeParam && TYPE_LABELS[typeParam] ? typeParam : "";
  const action = actionParam === "edit" || actionParam === "delete" ? actionParam : "";

  const timeZone = await getBusinessTimeZone();
  const supabase = await createClient();
  let query = supabase
    .from("entry_changes")
    .select("id, entity_type, entity_id, entity_label, action, reason, old_values, new_values, changed_by, changed_at")
    .order("changed_at", { ascending: false })
    .limit(300);
  if (type) query = query.eq("entity_type", type);
  if (action) query = query.eq("action", action);
  const { data, error } = await query;
  const rows = (data ?? []) as ChangeRow[];

  // Names of the people who made the changes
  const names = new Map<string, string>();
  const userIds = [...new Set(rows.map((r) => r.changed_by))];
  if (userIds.length > 0) {
    const { data: people } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
    for (const p of (people ?? []) as { id: string; full_name: string | null }[]) {
      names.set(p.id, p.full_name || "User");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-3">
        <BackLink href="/settings">Settings</BackLink>
        <PageHeader
          icon={History}
          title="Edit & delete history"
          description="Every change to saved entries: who, when, old and new values, and the reason."
        />
      </div>

      <form method="get" className={cardClass + " grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"}>
        <div>
          <label htmlFor="history-type" className={labelClass}>
            Entry
          </label>
          <select id="history-type" name="type" defaultValue={type} className={inputClass}>
            <option value="">All</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="history-action" className={labelClass}>
            Change
          </label>
          <select id="history-action" name="action" defaultValue={action} className={inputClass}>
            <option value="">Edits and deletes</option>
            <option value="edit">Edits</option>
            <option value="delete">Deletes</option>
          </select>
        </div>
        <button type="submit" className={secondaryButtonClass}>
          Show
        </button>
      </form>

      {error ? (
        <Notice kind="error">Could not load the history: {error.message}</Notice>
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title="No changes yet" text="Edits and deletes of saved entries appear here." />
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const href = entryHref(row);
            return (
              <li key={row.id} className={cardClass + " space-y-1.5"}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Pill tone={row.action === "delete" ? "coral" : "teal"}>
                      {row.action === "delete" ? "Deleted" : "Edited"}
                    </Pill>
                    <span className="text-sm font-semibold text-ink">
                      {TYPE_LABELS[row.entity_type] ?? row.entity_type}
                      {row.entity_label ? `: ${row.entity_label}` : ""}
                    </span>
                    {href && (
                      <Link href={href} className="text-xs font-semibold text-accent">
                        Open
                      </Link>
                    )}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {formatDateTime(row.changed_at, timeZone)} · {names.get(row.changed_by) ?? "User"}
                  </span>
                </div>
                <p className="text-sm text-ink">{describeChange(row.old_values, row.new_values)}</p>
                <p className="text-xs text-ink-muted">Reason: {row.reason}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
