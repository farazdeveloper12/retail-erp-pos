import type { Metadata } from "next";
import Link from "next/link";
import { PackageMinus, Plus, RotateCcw, Search, ShieldCheck } from "lucide-react";
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
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { formatDateWith, formatInvoiceNo, type DateFormat } from "@/lib/format";
import {
  CLAIM_STATUSES,
  claimStatusLabel,
  claimTone,
  formatClaimNo,
  formatPurchaseNo,
  formatPurchaseReturnNo,
  formatSalesReturnNo,
  warrantyStatusLabel,
} from "@/lib/returns";

export const metadata: Metadata = {
  title: "Returns & Warranty",
};

type Tab = "sales" | "purchases" | "warranty";

type SalesReturnRow = {
  id: string;
  return_no: number;
  return_date: string;
  reason: string;
  total: number | string;
  refund_amount: number | string;
  credit_amount: number | string;
  sale: { invoice_no: number; customer_name: string | null } | null;
};

type PurchaseReturnRow = {
  id: string;
  return_no: number;
  return_date: string;
  reason: string;
  total: number | string;
  refund_amount: number | string;
  credit_amount: number | string;
  purchase: { purchase_no: number } | null;
  supplier: { name: string } | null;
};

type ClaimRow = {
  id: string;
  claim_no: number;
  status: string;
  item_description: string;
  imei: string | null;
  customer_name: string | null;
  received_on: string;
  under_warranty: boolean;
};

type LookupRow = {
  sale_item_id: string;
  sale_id: string;
  invoice_no: number;
  sold_on: string;
  customer_name: string | null;
  customer_phone: string | null;
  description: string;
  imei: string | null;
  quantity: number;
  warranty_days: number;
  expires_on: string;
  days_left: number;
  warranty_status: string;
  returned_qty: number;
  open_claim_id: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "returns")) {
    return <AccessDenied />;
  }
  const canSalesReturn = permissions.includes("returns.manage");
  const canPurchaseReturn = permissions.includes("purchases.manage");
  const canSeePurchaseReturns = canPurchaseReturn || permissions.includes("purchases.view");
  const canLookup = canSalesReturn || permissions.includes("sales.create");

  const params = await searchParams;
  const tabs: { key: Tab; label: string; allowed: boolean }[] = [
    { key: "sales", label: "Sales returns", allowed: canSalesReturn },
    { key: "purchases", label: "Purchase returns", allowed: canSeePurchaseReturns },
    { key: "warranty", label: "Warranty", allowed: canLookup },
  ];
  const allowedTabs = tabs.filter((t) => t.allowed);
  const tab = (allowedTabs.find((t) => t.key === params.tab) ?? allowedTabs[0])?.key ?? "warranty";

  const from = params.from && DATE_PATTERN.test(params.from) ? params.from : "";
  const to = params.to && DATE_PATTERN.test(params.to) ? params.to : "";
  const q = (params.q ?? "").trim().slice(0, 40);
  const status = params.status && (CLAIM_STATUSES as string[]).includes(params.status) ? params.status : "";

  const supabase = await createClient();
  const business = await getMyBusiness();
  const currency = business?.currency_code || "PKR";
  const dateFormat = (business?.date_format ?? "medium") as DateFormat;

  let salesReturns: SalesReturnRow[] = [];
  let purchaseReturns: PurchaseReturnRow[] = [];
  let claims: ClaimRow[] = [];
  let lookup: LookupRow[] | null = null;
  let error: string | null = null;

  if (tab === "sales") {
    let query = supabase
      .from("sales_returns")
      .select("id, return_no, return_date, reason, total, refund_amount, credit_amount, sale:sales(invoice_no, customer_name)")
      .order("return_date", { ascending: false })
      .order("return_no", { ascending: false })
      .limit(100);
    if (from) query = query.gte("return_date", from);
    if (to) query = query.lte("return_date", to);
    const { data, error: e } = await query;
    salesReturns = (data ?? []) as unknown as SalesReturnRow[];
    error = e?.message ?? null;
  } else if (tab === "purchases") {
    let query = supabase
      .from("purchase_returns")
      .select(
        "id, return_no, return_date, reason, total, refund_amount, credit_amount, purchase:purchases(purchase_no), supplier:suppliers(name)"
      )
      .order("return_date", { ascending: false })
      .order("return_no", { ascending: false })
      .limit(100);
    if (from) query = query.gte("return_date", from);
    if (to) query = query.lte("return_date", to);
    const { data, error: e } = await query;
    purchaseReturns = (data ?? []) as unknown as PurchaseReturnRow[];
    error = e?.message ?? null;
  } else {
    if (q.length >= 2) {
      const { data, error: e } = await supabase.rpc("warranty_lookup", { p_query: q });
      lookup = (data ?? []) as LookupRow[];
      error = e?.message ?? null;
    }
    if (canSalesReturn) {
      let query = supabase
        .from("warranty_claims")
        .select("id, claim_no, status, item_description, imei, customer_name, received_on, under_warranty")
        .order("created_at", { ascending: false })
        .limit(100);
      if (status) query = query.eq("status", status);
      else query = query.neq("status", "returned");
      const { data, error: e } = await query;
      claims = (data ?? []) as ClaimRow[];
      error = error ?? e?.message ?? null;
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={RotateCcw}
        title="Returns & Warranty"
        description="Items returned by customers, items sent back to suppliers, and warranty claims."
        action={
          <div className="flex flex-wrap gap-2">
            {canSalesReturn && (
              <Link href="/returns/sales/new" className={primaryButtonClass}>
                <Plus className="h-4 w-4" />
                Sales return
              </Link>
            )}
            {canPurchaseReturn && (
              <Link href="/returns/purchases/new" className={secondaryButtonClass}>
                <PackageMinus className="h-4 w-4" />
                Return to supplier
              </Link>
            )}
            {canSalesReturn && (
              <Link href="/returns/warranty/new" className={secondaryButtonClass}>
                <ShieldCheck className="h-4 w-4" />
                Warranty claim
              </Link>
            )}
          </div>
        }
      />

      <nav aria-label="Sections" className="flex gap-2 overflow-x-auto pb-1">
        {allowedTabs.map((t) => (
          <Link
            key={t.key}
            href={`/returns?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={
              "inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold " +
              (tab === t.key
                ? "border-transparent bg-pill text-pill-ink"
                : "border-line bg-surface text-ink-muted hover:text-ink")
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {error && <Notice kind="error">{error}</Notice>}

      {(tab === "sales" || tab === "purchases") && (
        <form method="get" className={cardClass + " grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"}>
          <input type="hidden" name="tab" value={tab} />
          <div>
            <label htmlFor="r-from" className={labelClass}>
              From
            </label>
            <input id="r-from" name="from" type="date" defaultValue={from} className={inputClass} />
          </div>
          <div>
            <label htmlFor="r-to" className={labelClass}>
              To
            </label>
            <input id="r-to" name="to" type="date" defaultValue={to} className={inputClass} />
          </div>
          <button type="submit" className={primaryButtonClass}>
            Show
          </button>
        </form>
      )}

      {tab === "sales" &&
        (salesReturns.length === 0 ? (
          <EmptyState
            icon={RotateCcw}
            title="No sales returns"
            text="Open an invoice and choose Return items, or use the Sales return button."
          />
        ) : (
          <ul className="space-y-3">
            {salesReturns.map((r) => (
              <li key={r.id}>
                <Link href={`/returns/sales/${r.id}`} className={cardClass + " block hover:border-accent"}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">
                        {formatSalesReturnNo(r.return_no)}{" "}
                        <span className="text-sm font-normal text-ink-muted">
                          · invoice {formatInvoiceNo(r.sale?.invoice_no)}
                        </span>
                      </p>
                      <p className="text-sm text-ink-muted">
                        {formatDateWith(r.return_date, dateFormat)} · {r.sale?.customer_name || "Walk-in customer"} ·{" "}
                        {r.reason}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-ink">{formatMoney(r.total, currency)}</p>
                      <p className="text-xs text-ink-muted">
                        Refund {formatMoney(r.refund_amount, currency)} · credit {formatMoney(r.credit_amount, currency)}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ))}

      {tab === "purchases" &&
        (purchaseReturns.length === 0 ? (
          <EmptyState
            icon={PackageMinus}
            title="No purchase returns"
            text="Open a purchase and choose Return to supplier, or use the button above."
          />
        ) : (
          <ul className="space-y-3">
            {purchaseReturns.map((r) => (
              <li key={r.id}>
                <Link href={`/returns/purchases/${r.id}`} className={cardClass + " block hover:border-accent"}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">
                        {formatPurchaseReturnNo(r.return_no)}{" "}
                        <span className="text-sm font-normal text-ink-muted">
                          · purchase {formatPurchaseNo(r.purchase?.purchase_no)}
                        </span>
                      </p>
                      <p className="text-sm text-ink-muted">
                        {formatDateWith(r.return_date, dateFormat)} · {r.supplier?.name ?? "Supplier"} · {r.reason}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-ink">{formatMoney(r.total, currency)}</p>
                      <p className="text-xs text-ink-muted">
                        Money back {formatMoney(r.refund_amount, currency)} · less owed{" "}
                        {formatMoney(r.credit_amount, currency)}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ))}

      {tab === "warranty" && (
        <>
          <form method="get" className={cardClass + " space-y-3"}>
            <input type="hidden" name="tab" value="warranty" />
            <label htmlFor="w-q" className={labelClass}>
              Check warranty
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="w-q"
                name="q"
                type="search"
                minLength={2}
                maxLength={40}
                defaultValue={q}
                placeholder="IMEI, invoice number (INV-000042) or customer phone"
                className={inputClass}
              />
              <button type="submit" className={primaryButtonClass}>
                <Search className="h-4 w-4" />
                Search
              </button>
            </div>
          </form>

          {lookup !== null &&
            (lookup.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
                Nothing sold matches “{q}”.
              </p>
            ) : (
              <ul className="space-y-3">
                {lookup.map((row) => {
                  const fullyReturned = row.returned_qty >= row.quantity;
                  return (
                    <li key={row.sale_item_id} className={cardClass}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{row.description}</p>
                          {row.imei && <p className="tabular-nums text-xs text-ink-muted">IMEI {row.imei}</p>}
                          <p className="mt-1 text-sm text-ink-muted">
                            <Link href={`/sales/${row.sale_id}`} className="font-semibold text-accent">
                              {formatInvoiceNo(row.invoice_no)}
                            </Link>{" "}
                            · sold {formatDateWith(row.sold_on, dateFormat)} · {row.customer_name || "Walk-in customer"}
                            {row.customer_phone ? ` · ${row.customer_phone}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <Pill
                            tone={
                              fullyReturned
                                ? "neutral"
                                : row.warranty_status === "active"
                                  ? "mint"
                                  : row.warranty_status === "expired"
                                    ? "coral"
                                    : "neutral"
                            }
                          >
                            {fullyReturned ? "Returned" : warrantyStatusLabel(row.warranty_status, row.days_left)}
                          </Pill>
                          {row.warranty_days > 0 && (
                            <p className="text-xs text-ink-muted">
                              Until {formatDateWith(row.expires_on, dateFormat)}
                            </p>
                          )}
                        </div>
                      </div>
                      {canSalesReturn && !fullyReturned && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {row.open_claim_id ? (
                            <Link href={`/returns/warranty/${row.open_claim_id}`} className={secondaryButtonClass}>
                              Open claim
                            </Link>
                          ) : (
                            <Link
                              href={`/returns/warranty/new?item=${row.sale_item_id}`}
                              className={secondaryButtonClass}
                            >
                              <ShieldCheck className="h-4 w-4" />
                              New warranty claim
                            </Link>
                          )}
                          <Link href={`/returns/sales/new?sale=${row.sale_id}`} className={secondaryButtonClass}>
                            <RotateCcw className="h-4 w-4" />
                            Return
                          </Link>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}

          {canSalesReturn && (
            <section className="space-y-3" aria-labelledby="claims-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="claims-title" className="text-lg font-bold text-ink">
                  {status ? `Claims: ${claimStatusLabel(status)}` : "Open claims"}
                </h2>
                <div className="flex flex-wrap gap-1">
                  <Link
                    href="/returns?tab=warranty"
                    className={
                      "inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold " +
                      (!status ? "bg-pill text-pill-ink" : "text-ink-muted hover:text-ink")
                    }
                  >
                    Open
                  </Link>
                  {CLAIM_STATUSES.map((s) => (
                    <Link
                      key={s}
                      href={`/returns?tab=warranty&status=${s}`}
                      className={
                        "inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold " +
                        (status === s ? "bg-pill text-pill-ink" : "text-ink-muted hover:text-ink")
                      }
                    >
                      {claimStatusLabel(s)}
                    </Link>
                  ))}
                </div>
              </div>
              {claims.length === 0 ? (
                <EmptyState icon={ShieldCheck} title="No claims here" text="Warranty claims you record appear here." />
              ) : (
                <ul className="space-y-3">
                  {claims.map((c) => (
                    <li key={c.id}>
                      <Link href={`/returns/warranty/${c.id}`} className={cardClass + " block hover:border-accent"}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-ink">
                              {formatClaimNo(c.claim_no)} · {c.item_description}
                            </p>
                            <p className="text-sm text-ink-muted">
                              {formatDateWith(c.received_on, dateFormat)} · {c.customer_name || "Customer"}
                              {c.imei ? ` · IMEI ${c.imei}` : ""}
                              {c.under_warranty ? "" : " · outside warranty"}
                            </p>
                          </div>
                          <Pill tone={claimTone(c.status)}>{claimStatusLabel(c.status)}</Pill>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
