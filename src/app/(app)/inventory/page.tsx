import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Boxes, Headphones, PackageX, Search, SearchX, Smartphone, TriangleAlert } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import {
  EmptyState,
  Notice,
  PageHeader,
  Pill,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { PTA_OPTIONS, isPtaStatus, ptaLabel, showsPta } from "@/lib/pta";
import { DEFAULT_LOW_STOCK_THRESHOLD, getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { formatMoney, toCents } from "@/lib/money";
import { formatInvoiceNo } from "@/lib/format";
import InventoryTabs from "@/app/(app)/inventory/InventoryTabs";

export const metadata: Metadata = {
  title: "Inventory",
};

// The low stock threshold comes from Settings (the dashboard uses the same value)
const PAGE_SIZE = 50;
// Keeps ".in(...)" filters short enough for the request URL
const IN_CHUNK = 200;

const ZERO = BigInt(0);

type Db = Awaited<ReturnType<typeof createClient>>;

type Params = {
  tab?: string;
  q?: string;
  status?: string;
  condition?: string;
  pta?: string;
  filter?: string;
  page?: string;
};

type PhoneRow = {
  id: string;
  imei: string;
  brand_name: string | null;
  model_name: string | null;
  storage_gb: number | null;
  ram_gb: number | null;
  color_name: string | null;
  condition: string | null;
  sale_price: number | string | null;
  status: string | null;
  purchase_id: string | null;
  sale_id: string | null;
  created_at: string;
  sold_at: string | null;
  pta_status: string | null;
};

const CONDITIONS: { value: string; label: string }[] = [
  { value: "new", label: "New" },
  { value: "used", label: "Used" },
  { value: "open_box", label: "Open box" },
  { value: "refurbished", label: "Refurbished" },
];
const CONDITION_LABELS = Object.fromEntries(CONDITIONS.map((c) => [c.value, c.label]));

// ---------- Small helpers ----------

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) out.push(items.slice(i, i + IN_CHUNK));
  return out;
}

// Characters that act as wildcards or separators in filters are removed
function cleanSearch(value: string) {
  return value.replace(/[%_*\\,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

function storageLabel(gb: number | null, ram: number | null) {
  if (gb === null) return null;
  const storage = gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`;
  return ram ? `${storage} / ${ram} GB RAM` : storage;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Asia/Karachi" }).format(date);
}

function inventoryHref(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== 1) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `/inventory?${text}` : "/inventory";
}

function StatusPill({ status }: { status: string | null }) {
  if (status === "in_stock") return <Pill tone="mint">In stock</Pill>;
  if (status === "sold") return <Pill tone="neutral">Sold</Pill>;
  if (status === "returned_to_supplier") return <Pill tone="neutral">Returned to supplier</Pill>;
  if (status === "written_off") return <Pill tone="neutral">Written off</Pill>;
  return <Pill tone="neutral">{status ?? "Unknown"}</Pill>;
}

function SummaryCard({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value?: string;
  tone: string;
  children?: ReactNode;
}) {
  return (
    <div className={"rounded-card p-4 sm:p-5 " + tone}>
      {children ?? <p className="text-xl font-bold text-ink sm:text-2xl">{value}</p>}
      <p className="mt-1.5 text-sm font-medium text-ink">{label}</p>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={secondaryButtonClass}>
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-ink-muted">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={secondaryButtonClass}>
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

// ---------- Phones ----------

async function inStockCount(supabase: Db, condition?: string) {
  let query = supabase
    .from("phone_units")
    .select("id", { count: "exact", head: true })
    .eq("status", "in_stock");
  if (condition) query = query.eq("condition", condition);
  const { count } = await query;
  return count ?? 0;
}

// Sum of landed_cost for all in-stock phones (only called for cost users)
async function phoneStockValue(supabase: Db): Promise<bigint> {
  const { data } = await supabase.from("phone_units").select("id").eq("status", "in_stock").limit(20000);
  const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
  let total = ZERO;
  for (const part of chunks(ids)) {
    const { data: costs } = await supabase
      .from("phone_unit_costs")
      .select("unit_id, landed_cost")
      .in("unit_id", part);
    for (const row of (costs ?? []) as { landed_cost: unknown }[]) total += toCents(row.landed_cost) ?? ZERO;
  }
  return total;
}

async function PhonesTab({
  params,
  seesCost,
  canOpenPurchases,
  canOpenSales,
  currency,
}: {
  params: Params;
  seesCost: boolean;
  canOpenPurchases: boolean;
  canOpenSales: boolean;
  currency: string;
}) {
  const supabase = await createClient();
  const status = params.status === "sold" || params.status === "all" ? params.status : "in_stock";
  const condition = CONDITIONS.some((c) => c.value === params.condition) ? params.condition! : "";
  // PTA filter (PKR shops): approved, non_pta, jv or unknown (not recorded)
  const ptaShown = showsPta(currency);
  const pta = ptaShown && (isPtaStatus(params.pta) || params.pta === "unknown") ? params.pta! : "";
  const q = cleanSearch(params.q ?? "");
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  let query = supabase
    .from("phone_units")
    .select(
      "id, imei, brand_name, model_name, storage_gb, ram_gb, color_name, condition, sale_price, status, purchase_id, sale_id, created_at, sold_at, pta_status",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status !== "all") query = query.eq("status", status);
  if (condition) query = query.eq("condition", condition);
  if (pta === "unknown") query = query.is("pta_status", null);
  else if (pta) query = query.eq("pta_status", pta);
  if (q) {
    const compact = q.replace(/\s+/g, "");
    if (/^\d{3,15}$/.test(compact)) {
      // Partial IMEI, for example the last 4 to 6 digits
      query = query.ilike("imei", `%${compact}%`);
    } else {
      // Every word must match the brand or the model name
      const words = q.split(" ").filter(Boolean).slice(0, 5);
      const groups = words.map((w) => `or(brand_name.ilike.%${w}%,model_name.ilike.%${w}%)`);
      query = query.or(`and(${groups.join(",")})`);
    }
  }

  const [{ data, error, count }, total, ...byCondition] = await Promise.all([
    query,
    inStockCount(supabase),
    ...CONDITIONS.map((c) => inStockCount(supabase, c.value)),
  ]);
  const phones = (data ?? []) as PhoneRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  // Costs are read only for users who may see them
  let stockValue: bigint | null = null;
  const costById = new Map<string, bigint | null>();
  if (seesCost) {
    stockValue = await phoneStockValue(supabase);
    if (phones.length > 0) {
      const { data: costs } = await supabase
        .from("phone_unit_costs")
        .select("unit_id, landed_cost")
        .in(
          "unit_id",
          phones.map((p) => p.id)
        );
      for (const row of (costs ?? []) as { unit_id: string; landed_cost: unknown }[]) {
        costById.set(row.unit_id, toCents(row.landed_cost));
      }
    }
  }

  // Purchase numbers and invoice numbers for the links on this page
  const purchaseNos = new Map<string, string>();
  const invoiceNos = new Map<string, string>();
  const purchaseIds = [...new Set(phones.map((p) => p.purchase_id).filter((v): v is string => Boolean(v)))];
  const saleIds = [...new Set(phones.map((p) => p.sale_id).filter((v): v is string => Boolean(v)))];
  await Promise.all([
    canOpenPurchases && purchaseIds.length > 0
      ? supabase
          .from("purchases")
          .select("id, purchase_no")
          .in("id", purchaseIds)
          .then(({ data: rows }) => {
            for (const r of (rows ?? []) as { id: string; purchase_no: unknown }[]) {
              purchaseNos.set(r.id, String(r.purchase_no ?? ""));
            }
          })
      : null,
    canOpenSales && saleIds.length > 0
      ? supabase
          .from("sales")
          .select("id, invoice_no")
          .in("id", saleIds)
          .then(({ data: rows }) => {
            for (const r of (rows ?? []) as { id: string; invoice_no: unknown }[]) {
              invoiceNos.set(r.id, formatInvoiceNo(r.invoice_no));
            }
          })
      : null,
  ]);

  const base = {
    tab: "phones",
    q: params.q,
    status: status === "in_stock" ? undefined : status,
    condition,
    pta: pta || undefined,
  };
  const filtering = Boolean(q || condition || pta || status !== "in_stock");

  function PurchaseLink({ phone }: { phone: PhoneRow }) {
    if (!canOpenPurchases || !phone.purchase_id) return null;
    const number = purchaseNos.get(phone.purchase_id);
    return (
      <Link
        href={`/purchases/${phone.purchase_id}`}
        className="inline-flex min-h-11 items-center text-xs font-semibold text-accent hover:text-accent-strong"
      >
        Purchase {number ? `#${number}` : ""}
      </Link>
    );
  }

  function SaleInfo({ phone }: { phone: PhoneRow }) {
    if (phone.status !== "sold") return null;
    return (
      <span className="text-xs text-ink-muted">
        Sold {formatDate(phone.sold_at)}
        {canOpenSales && phone.sale_id && (
          <>
            {" · "}
            <Link
              href={`/sales/${phone.sale_id}`}
              className="font-semibold text-accent hover:text-accent-strong"
            >
              {invoiceNos.get(phone.sale_id) ?? "Invoice"}
            </Link>
          </>
        )}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <section aria-label="Phones in stock" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="Phones in stock" value={String(total)} tone="bg-aqua" />
        {CONDITIONS.map((c, i) => (
          <SummaryCard
            key={c.value}
            label={`${c.label} in stock`}
            value={String(byCondition[i])}
            tone={["bg-mint", "bg-peach", "bg-lavender", "bg-mint"][i]}
          />
        ))}
        {stockValue !== null && (
          <SummaryCard label="Stock value (cost)" value={formatMoney(stockValue, currency)} tone="bg-peach" />
        )}
      </section>

      {/* Filters */}
      <form
        method="get"
        className={
          cardClass +
          (ptaShown
            ? " grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
            : " grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end")
        }
      >
        <input type="hidden" name="tab" value="phones" />
        <div>
          <label htmlFor="phone-q" className={labelClass}>
            IMEI, brand or model
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              id="phone-q"
              name="q"
              type="search"
              defaultValue={params.q ?? ""}
              placeholder="e.g. last 4 digits of the IMEI"
              className={inputClass + " pl-10"}
            />
          </div>
        </div>
        <div>
          <label htmlFor="phone-status" className={labelClass}>
            Status
          </label>
          <select id="phone-status" name="status" defaultValue={status} className={inputClass}>
            <option value="in_stock">In stock</option>
            <option value="sold">Sold</option>
            <option value="all">All</option>
          </select>
        </div>
        <div>
          <label htmlFor="phone-condition" className={labelClass}>
            Condition
          </label>
          <select id="phone-condition" name="condition" defaultValue={condition} className={inputClass}>
            <option value="">All</option>
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        {ptaShown && (
          <div>
            <label htmlFor="phone-pta" className={labelClass}>
              PTA status
            </label>
            <select id="phone-pta" name="pta" defaultValue={pta} className={inputClass}>
              <option value="">All</option>
              {PTA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value="unknown">Not recorded</option>
            </select>
          </div>
        )}
        <div className="flex gap-2">
          <button type="submit" className={primaryButtonClass + " flex-1"}>
            Search
          </button>
          {filtering && (
            <Link href="/inventory?tab=phones" className={secondaryButtonClass + " flex-1"}>
              Clear
            </Link>
          )}
        </div>
      </form>

      {/* List */}
      {error ? (
        <Notice kind="error">Could not load phones: {error.message}</Notice>
      ) : phones.length === 0 ? (
        filtering ? (
          <EmptyState icon={SearchX} title="No phones match your filters" text="Try a different IMEI, model, status or condition." />
        ) : (
          <EmptyState icon={Smartphone} title="No phones in stock" text="Phones appear here after they are recorded in a purchase." />
        )
      ) : (
        <section aria-label="Phones" className="space-y-3">
          <p className="text-sm text-ink-muted">
            {count ?? phones.length} {(count ?? phones.length) === 1 ? "phone" : "phones"}
          </p>

          <ul className="space-y-3 md:hidden">
            {phones.map((phone) => {
              const cost = costById.get(phone.id) ?? null;
              return (
                <li key={phone.id} className={cardClass}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">
                        {`${phone.brand_name ?? ""} ${phone.model_name ?? ""}`.trim() || "Phone"}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {[
                          storageLabel(phone.storage_gb, phone.ram_gb),
                          phone.color_name,
                          phone.condition ? CONDITION_LABELS[phone.condition] ?? phone.condition : null,
                          ptaLabel(phone.pta_status),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="mt-1 font-mono text-xs text-ink">IMEI {phone.imei}</p>
                    </div>
                    <StatusPill status={phone.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      <span className="text-xs text-ink-muted">Sale price </span>
                      <span className="font-semibold text-ink">{formatMoney(phone.sale_price, currency)}</span>
                      {seesCost && (
                        <span className="ml-2 text-xs text-ink-muted">Cost {formatMoney(cost, currency)}</span>
                      )}
                    </span>
                    <PurchaseLink phone={phone} />
                  </div>
                  <SaleInfo phone={phone} />
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">IMEI</th>
                  <th className="px-4 py-3">Condition</th>
                  <th className="px-4 py-3 text-right">Sale price</th>
                  {seesCost && <th className="px-4 py-3 text-right">Cost</th>}
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Links</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {phones.map((phone) => (
                  <tr key={phone.id} className="border-b border-line align-top last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">
                        {`${phone.brand_name ?? ""} ${phone.model_name ?? ""}`.trim() || "Phone"}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {[storageLabel(phone.storage_gb, phone.ram_gb), phone.color_name].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink">{phone.imei}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {phone.condition ? CONDITION_LABELS[phone.condition] ?? phone.condition : "—"}
                      {ptaLabel(phone.pta_status) && (
                        <span className="block text-xs text-ink-muted">{ptaLabel(phone.pta_status)}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">
                      {formatMoney(phone.sale_price, currency)}
                    </td>
                    {seesCost && (
                      <td className="whitespace-nowrap px-4 py-3 text-right text-ink-muted">
                        {formatMoney(costById.get(phone.id) ?? null, currency)}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <StatusPill status={phone.status} />
                        <SaleInfo phone={phone} />
                      </div>
                    </td>
                    <td className="px-4 py-1 text-right">
                      <PurchaseLink phone={phone} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} totalPages={totalPages} hrefFor={(p) => inventoryHref({ ...base, page: p })} />
        </section>
      )}
    </div>
  );
}

// ---------- Accessories ----------

type AccessoryItem = {
  id: string;
  name: string;
  salePrice: number | string | null;
  qty: number;
  avgCost: bigint | null;
};

async function AccessoriesTab({
  params,
  seesCost,
  currency,
  lowStockThreshold,
}: {
  params: Params;
  seesCost: boolean;
  currency: string;
  lowStockThreshold: number;
}) {
  const LOW_STOCK_THRESHOLD = lowStockThreshold;
  const supabase = await createClient();
  const filter = params.filter === "low" || params.filter === "out" ? params.filter : "all";
  const q = cleanSearch(params.q ?? "").toLowerCase();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  // All active products, including those with no stock left
  const { data: productData, error } = await supabase
    .from("products")
    .select("id, name, sale_price")
    .eq("is_active", true)
    .order("name")
    .limit(10000);
  const products = (productData ?? []) as { id: string; name: string; sale_price: number | string | null }[];
  const ids = products.map((p) => p.id);

  const qtyById = new Map<string, number>();
  const costById = new Map<string, bigint | null>();
  for (const part of chunks(ids)) {
    const [{ data: stock }, costs] = await Promise.all([
      supabase.from("product_stock").select("product_id, qty").in("product_id", part),
      // Costs are read only for users who may see them
      seesCost
        ? supabase.from("product_costs").select("product_id, avg_cost").in("product_id", part)
        : Promise.resolve({ data: null }),
    ]);
    for (const row of (stock ?? []) as { product_id: string; qty: unknown }[]) {
      const n = Number(row.qty);
      qtyById.set(row.product_id, Number.isFinite(n) ? n : 0);
    }
    for (const row of (costs.data ?? []) as { product_id: string; avg_cost: unknown }[]) {
      costById.set(row.product_id, toCents(row.avg_cost));
    }
  }

  const all: AccessoryItem[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    salePrice: p.sale_price,
    qty: qtyById.get(p.id) ?? 0,
    avgCost: seesCost ? costById.get(p.id) ?? null : null,
  }));

  // Summary over every active product
  const totalUnits = all.reduce((sum, item) => sum + Math.max(item.qty, 0), 0);
  const lowCount = all.filter((item) => item.qty <= LOW_STOCK_THRESHOLD).length;
  const outCount = all.filter((item) => item.qty <= 0).length;
  const stockValue = seesCost
    ? all.reduce<bigint>(
        (sum, item) => sum + (item.avgCost ?? ZERO) * BigInt(Math.max(Math.floor(item.qty), 0)),
        ZERO
      )
    : null;

  const filtered = all.filter((item) => {
    if (q && !item.name.toLowerCase().includes(q)) return false;
    if (filter === "low") return item.qty <= LOW_STOCK_THRESHOLD;
    if (filter === "out") return item.qty <= 0;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const base = { tab: "accessories", q: params.q, filter: filter === "all" ? undefined : filter };
  const filtering = Boolean(q || filter !== "all");

  function Qty({ qty }: { qty: number }) {
    if (qty <= 0) {
      return (
        <span className="inline-flex items-center rounded-full bg-danger-soft px-2.5 py-1 text-xs font-semibold text-danger">
          0
        </span>
      );
    }
    if (qty <= LOW_STOCK_THRESHOLD) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-peach px-2.5 py-1 text-xs font-semibold text-ink">
          <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden="true" />
          {qty}
        </span>
      );
    }
    return <span className="font-semibold text-ink">{qty}</span>;
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <section aria-label="Accessory stock" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard label="Accessory products" value={String(all.length)} tone="bg-aqua" />
        <SummaryCard label="Total units" value={String(totalUnits)} tone="bg-mint" />
        <SummaryCard label="Low stock" tone="bg-lavender">
          {lowCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-peach px-3 py-1 text-lg font-bold text-ink">
              <span className="h-2 w-2 rounded-full bg-coral" aria-hidden="true" />
              {lowCount}
            </span>
          ) : (
            <p className="text-xl font-bold text-ink sm:text-2xl">0</p>
          )}
        </SummaryCard>
        <SummaryCard label="Out of stock" value={String(outCount)} tone="bg-peach" />
        {stockValue !== null && (
          <SummaryCard label="Stock value (cost)" value={formatMoney(stockValue, currency)} tone="bg-aqua" />
        )}
      </section>

      {/* Filters */}
      <form method="get" className={cardClass + " grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end"}>
        <input type="hidden" name="tab" value="accessories" />
        <div>
          <label htmlFor="accessory-q" className={labelClass}>
            Name
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input
              id="accessory-q"
              name="q"
              type="search"
              defaultValue={params.q ?? ""}
              placeholder="Search accessories..."
              className={inputClass + " pl-10"}
            />
          </div>
        </div>
        <div>
          <label htmlFor="accessory-filter" className={labelClass}>
            Show
          </label>
          <select id="accessory-filter" name="filter" defaultValue={filter} className={inputClass}>
            <option value="all">All</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className={primaryButtonClass + " flex-1"}>
            Search
          </button>
          {filtering && (
            <Link href="/inventory?tab=accessories" className={secondaryButtonClass + " flex-1"}>
              Clear
            </Link>
          )}
        </div>
      </form>

      {/* List */}
      {error ? (
        <Notice kind="error">Could not load accessories: {error.message}</Notice>
      ) : shown.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={filter === "out" ? PackageX : filter === "low" ? TriangleAlert : SearchX}
            title={
              filter === "low"
                ? "No low stock items"
                : filter === "out"
                  ? "Nothing is out of stock"
                  : "No accessories match your search"
            }
            text="Try a different name or filter."
          />
        ) : (
          <EmptyState icon={Headphones} title="No accessories yet" text="Accessories appear here after they are added to the catalog." />
        )
      ) : (
        <section aria-label="Accessories" className="space-y-3">
          <p className="text-sm text-ink-muted">
            {filtered.length} {filtered.length === 1 ? "product" : "products"}
          </p>

          <ul className="space-y-3 md:hidden">
            {shown.map((item) => (
              <li key={item.id} className={cardClass + " flex items-start justify-between gap-3"}>
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{item.name}</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Sale price <span className="font-semibold text-ink">{formatMoney(item.salePrice, currency)}</span>
                    {seesCost && <> · Avg cost {formatMoney(item.avgCost, currency)}</>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs text-ink-muted">In stock</span>
                  <Qty qty={item.qty} />
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3 text-right">In stock</th>
                  <th className="px-5 py-3 text-right">Sale price</th>
                  {seesCost && <th className="px-5 py-3 text-right">Average cost</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 font-semibold text-ink">{item.name}</td>
                    <td className="px-5 py-3 text-right">
                      <Qty qty={item.qty} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-ink">
                      {formatMoney(item.salePrice, currency)}
                    </td>
                    {seesCost && (
                      <td className="whitespace-nowrap px-5 py-3 text-right text-ink-muted">
                        {formatMoney(item.avgCost, currency)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} totalPages={totalPages} hrefFor={(p) => inventoryHref({ ...base, page: p })} />
        </section>
      )}
    </div>
  );
}

// ---------- Page ----------

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "inventory")) {
    return <AccessDenied />;
  }

  const params = await searchParams;
  const tab = params.tab === "accessories" ? "accessories" : "phones";
  const seesCost = permissions.includes("inventory.view_cost");
  const business = await getMyBusiness();
  const currency = business?.currency_code || "PKR";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader icon={Boxes} title="Inventory" description="What is in stock right now. Read only." />
        <InventoryTabs tab={tab} />
      </div>

      {tab === "phones" ? (
        <PhonesTab
          params={params}
          seesCost={seesCost}
          canOpenPurchases={canViewPage(permissions, "purchases")}
          canOpenSales={canViewPage(permissions, "sales")}
          currency={currency}
        />
      ) : (
        <AccessoriesTab
          params={params}
          seesCost={seesCost}
          currency={currency}
          lowStockThreshold={business?.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD}
        />
      )}
    </div>
  );
}
