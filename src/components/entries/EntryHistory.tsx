import { History } from "lucide-react";
import { cardClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

export type ChangeRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  entity_label: string | null;
  action: string;
  reason: string;
  old_values: unknown;
  new_values: unknown;
  changed_by: string;
  changed_at: string;
};

// "amount: 500 -> 450 · notes: (empty) -> paid late"
export function describeChange(oldValues: unknown, newValues: unknown): string {
  const old = (oldValues ?? {}) as Record<string, unknown>;
  const now = (newValues ?? {}) as Record<string, unknown>;
  const show = (v: unknown) => {
    if (v === null || v === undefined || v === "") return "(empty)";
    if (Array.isArray(v)) return `${v.length} line${v.length === 1 ? "" : "s"}`;
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  const parts: string[] = [];
  for (const key of new Set([...Object.keys(old), ...Object.keys(now)])) {
    if (key === "items") {
      const before = Array.isArray(old.items) ? (old.items as Record<string, unknown>[]) : [];
      const after = Array.isArray(now.items) ? (now.items as Record<string, unknown>[]) : [];
      for (const line of after) {
        const prev = before.find((b) => b.id === line.id);
        if (!prev) continue;
        const changes = Object.keys(line)
          .filter((k) => k !== "id" && k !== "description" && String(line[k] ?? "") !== String(prev[k] ?? ""))
          .map((k) => `${k.replace(/_/g, " ")} ${show(prev[k])} -> ${show(line[k])}`);
        if (changes.length) parts.push(`${String(line.description ?? "line")}: ${changes.join(", ")}`);
      }
      continue;
    }
    if (!(key in now)) {
      parts.push(`${key.replace(/_/g, " ")}: ${show(old[key])}`);
      continue;
    }
    if (String(old[key] ?? "") !== String(now[key] ?? "")) {
      parts.push(`${key.replace(/_/g, " ")}: ${show(old[key])} -> ${show(now[key])}`);
    }
  }
  return parts.join(" · ") || "No values changed";
}

// Small history list on an entry's detail page (not printed)
export default async function EntryHistory({ types, id }: { types: string[]; id: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("entry_changes")
    .select("id, entity_type, entity_id, entity_label, action, reason, old_values, new_values, changed_by, changed_at")
    .in("entity_type", types)
    .eq("entity_id", id)
    .order("changed_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as ChangeRow[];
  if (rows.length === 0) return null;

  return (
    <section className={cardClass + " print:hidden"} aria-label="Edit and delete history">
      <div className="mb-3 flex items-center gap-2">
        <History className="h-5 w-5 text-accent" />
        <h2 className="text-base font-bold text-ink">Edit history</h2>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {rows.map((row) => (
          <li key={row.id} className="space-y-1 px-4 py-3 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{row.action === "delete" ? "Deleted" : "Edited"}</span>
              <span className="text-xs text-ink-muted">{formatDateTime(row.changed_at)}</span>
            </p>
            <p className="text-ink">{describeChange(row.old_values, row.new_values)}</p>
            <p className="text-xs text-ink-muted">Reason: {row.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
