import type { Metadata } from "next";
import Link from "next/link";
import { FileX, Headphones, PackageMinus, Smartphone } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, EmptyState, PageHeader, Pill, cardClass, secondaryButtonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness, getBusinessTimeZone } from "@/lib/business";
import { canViewPage, getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { centsToPlain, formatMoney, toCents } from "@/lib/money";
import { formatDateTime, paymentMethodLabel } from "@/lib/format";
import PaySupplier from "@/app/(app)/purchases/[id]/PaySupplier";
import { cancelPurchase } from "@/app/(app)/purchases/[id]/actions";
import CancelDocument from "@/components/CancelDocument";
import { DeleteEntryButton } from "@/components/entries/EntryDialog";
import EntryHistory from "@/components/entries/EntryHistory";
import PaymentActions from "@/components/entries/PaymentActions";
import EditPurchaseForm from "@/app/(app)/purchases/[id]/EditPurchaseForm";

export const metadata: Metadata = {
  title: "Purchase details",
};

type PurchaseRow = {
  id: string;
  purchase_no: number | string | null;
  supplier_id: string | null;
  purchase_date: string | null;
  supplier_invoice_no: string | null;
  subtotal: number | string | null;
  extra_cost: number | string | null;
  total: number | string | null;
  paid_amount: number | string | null;
  payment_method: string | null;
  notes: string | null;
  returned_total?: number | string | null;
  refunded_total?: number | string | null;
  return_credit?: number | string | null;
};

type PurchaseItemRow = {
  id: string;
  item_type: string;
  description: string | null;
  condition: string | null;
  quantity: number | null;
  unit_cost: number | string | null;
  sale_price: number | string | null;
  line_total: number | string | null;
};

type PhoneUnitRow = {
  imei: string;
  status: string | null;
  model_name: string | null;
  storage_gb: number | null;
  color_name: string | null;
  condition: string | null;
};

const CONDITION_LABELS: Record<string, string> = {
  new: "New",
  used: "Used",
  open_box: "Open box",
  refurbished: "Refurbished",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00+05:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Asia/Karachi",
  }).format(date);
}

function StatusPill({ status }: { status: string | null }) {
  if (status === "in_stock") return <Pill tone="mint">In stock</Pill>;
  if (status === "sold") return <Pill tone="purple">Sold</Pill>;
  const label = status ? status.replace(/_/g, " ") : "Unknown";
  return <Pill tone="neutral">{label.charAt(0).toUpperCase() + label.slice(1)}</Pill>;
}

function ImeiList({ units }: { units: PhoneUnitRow[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {units.map((unit) => (
        <li
          key={unit.imei}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-muted py-1 pl-3 pr-1"
        >
          <span className="font-mono text-xs text-ink">{unit.imei}</span>
          <StatusPill status={unit.status} />
        </li>
      ))}
    </ul>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/purchases">Back to purchases</BackLink>
      <EmptyState
        icon={FileX}
        title="Purchase not found"
        text="This purchase does not exist or you do not have access to it."
      />
    </div>
  );
}

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "purchases")) {
    return <AccessDenied />;
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return <NotFound />;

  const supabase = await createClient();
  const { data: purchaseData } = await supabase
    .from("purchases")
    .select(
      "id, purchase_no, supplier_id, purchase_date, supplier_invoice_no, subtotal, extra_cost, total, paid_amount, payment_method, notes, status, voided_at, void_reason, returned_total, refunded_total, return_credit"
    )
    .eq("id", id)
    .maybeSingle();
  const purchase = purchaseData as
    | (PurchaseRow & { status: string | null; voided_at: string | null; void_reason: string | null })
    | null;
  if (!purchase) return <NotFound />;

  const [
    { data: itemData },
    { data: unitData },
    supplierResult,
    business,
    { data: paymentData },
  ] = await Promise.all([
    supabase
      .from("purchase_items")
      .select("id, item_type, description, condition, quantity, unit_cost, sale_price, line_total")
      .eq("purchase_id", id),
    supabase
      .from("phone_units")
      .select("imei, status, model_name, storage_gb, color_name, condition")
      .eq("purchase_id", id)
      .order("imei"),
    purchase.supplier_id
      ? supabase.from("suppliers").select("name, phone").eq("id", purchase.supplier_id).maybeSingle()
      : Promise.resolve({ data: null }),
    getMyBusiness(),
    // History of later payments; they are already included in paid_amount
    supabase
      .from("purchase_payments")
      .select("id, amount, method, created_at")
      .eq("purchase_id", id)
      .is("deleted_at", null)
      .order("created_at"),
  ]);
  const payments = (paymentData ?? []) as {
    id: string;
    amount: number | string | null;
    method: string | null;
    created_at: string;
  }[];
  const items = (itemData ?? []) as PurchaseItemRow[];
  const units = (unitData ?? []) as PhoneUnitRow[];
  const supplier = supplierResult.data as { name: string; phone: string | null } | null;
  const currency = business?.currency_code || "PKR";
  const timeZone = await getBusinessTimeZone();

  // Match IMEIs to phone lines. With one phone line every unit belongs to it;
  // otherwise match by model name and condition. Anything left is listed apart.
  const phoneLines = items.filter((item) => item.item_type === "phone");
  const unitsByLine = new Map<number, PhoneUnitRow[]>();
  const unassigned = new Set(units);
  if (phoneLines.length === 1) {
    unitsByLine.set(items.indexOf(phoneLines[0]), units);
    unassigned.clear();
  } else {
    items.forEach((item, index) => {
      if (item.item_type !== "phone") return;
      const description = (item.description ?? "").toLowerCase();
      const matched = [...unassigned].filter(
        (unit) =>
          (!item.condition || unit.condition === item.condition) &&
          unit.model_name &&
          description.includes(unit.model_name.toLowerCase())
      );
      const take = matched.slice(0, item.quantity ?? matched.length);
      take.forEach((unit) => unassigned.delete(unit));
      unitsByLine.set(index, take);
    });
  }

  // paid_amount already includes later payments (record_supplier_payment
  // raises it); purchase_payments is the history of those later payments.
  const total = toCents(purchase.total);
  // paid_amount also holds return credits (section 3 of the migration); show
  // the money actually paid and the returns separately
  const returnCredit = toCents(purchase.return_credit) ?? BigInt(0);
  const returnedTotal = toCents(purchase.returned_total) ?? BigInt(0);
  const refundedTotal = toCents(purchase.refunded_total) ?? BigInt(0);
  const totalPaid = (toCents(purchase.paid_amount) ?? BigInt(0)) - returnCredit;
  const paidLater = payments.reduce<bigint>(
    (sum, p) => sum + (toCents(p.amount) ?? BigInt(0)),
    BigInt(0)
  );
  const paidAtPurchase = totalPaid - paidLater;
  const cancelled = purchase.status === "void";
  // A cancelled purchase owes nothing; the money paid was recorded as returned
  const balance = cancelled ? BigInt(0) : total !== null ? total - totalPaid - returnCredit : null;
  // A purchase with returns cannot be cancelled as a whole
  const canCancel = !cancelled && returnedTotal === BigInt(0) && permissions.includes("purchases.manage");
  const canEditEntries = permissions.includes("entries.edit");
  const canDeleteEntries = permissions.includes("entries.delete");
  const canReturn = !cancelled && permissions.includes("purchases.manage");
  const canPay =
    !cancelled &&
    balance !== null &&
    balance > BigInt(0) &&
    hasAny(permissions, ["purchases.manage", "suppliers.manage"]);
  const purchaseNo = purchase.purchase_no === null ? "—" : String(purchase.purchase_no);

  const details: [string, string][] = [
    ["Date", formatDate(purchase.purchase_date)],
    ["Supplier", supplier?.name ?? "—"],
    ["Supplier phone", supplier?.phone || "—"],
    ["Supplier invoice no.", purchase.supplier_invoice_no || "—"],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-3">
        <BackLink href="/purchases">Back to purchases</BackLink>
        <PageHeader title={`Purchase ${purchaseNo}`} description="Stock received from a supplier." />
      </div>

      {cancelled && (
        <div role="status" className="rounded-card border-2 border-danger bg-danger-soft px-5 py-4 text-danger">
          <p className="text-lg font-black tracking-widest">CANCELLED</p>
          <p className="text-sm">
            Cancelled on {formatDateTime(purchase.voided_at, timeZone)}
            {purchase.void_reason?.trim() ? ` · Reason: ${purchase.void_reason.trim()}` : ""}
          </p>
        </div>
      )}

      {(canCancel || canReturn || canEditEntries || canDeleteEntries) && (
        <div className="flex flex-wrap gap-2 print:hidden">
          {canEditEntries && !cancelled && returnedTotal === BigInt(0) && (
            <EditPurchaseForm
              purchaseId={purchase.id}
              currency={currency}
              purchaseDate={purchase.purchase_date ?? ""}
              invoiceNo={purchase.supplier_invoice_no ?? ""}
              notes={purchase.notes ?? ""}
              lines={items.map((item) => ({
                id: item.id,
                description: item.description ?? "Item",
                quantity: item.quantity ?? 1,
                unit_cost: centsToPlain(toCents(item.unit_cost) ?? BigInt(0)),
              }))}
            />
          )}
          {canDeleteEntries && returnedTotal === BigInt(0) && (
            <DeleteEntryButton
              type="purchase"
              id={purchase.id}
              label="this purchase"
              explanation="The purchase is removed from lists and totals: its phones and accessories leave stock and the money paid with it comes back to Cash/Bank. Not possible when a phone of it is already sold or a later payment exists (delete those first)."
              afterHref="/purchases"
            />
          )}
          {canReturn && (
            <Link href={`/returns/purchases/new?purchase=${purchase.id}`} className={secondaryButtonClass}>
              <PackageMinus className="h-4 w-4" />
              Return to supplier
            </Link>
          )}
          {canCancel && (
            <CancelDocument
              id={purchase.id}
              buttonLabel="Cancel purchase"
              explanation="This removes the phones and accessories of this purchase from stock and records the money paid to the supplier as returned."
              keepLabel="Keep purchase"
              action={cancelPurchase}
            />
          )}
        </div>
      )}

      <section className={cardClass}>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {details.map(([label, value]) => (
            <div key={label} className="rounded-2xl bg-surface-muted px-4 py-3">
              <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        {purchase.notes?.trim() && (
          <p className="mt-4 whitespace-pre-line text-sm text-ink-muted">
            <span className="font-semibold text-ink">Notes: </span>
            {purchase.notes}
          </p>
        )}
      </section>

      <section className={cardClass}>
        <h2 className="mb-4 text-base font-bold text-ink">Items</h2>
        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
            No items on this purchase.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item, index) => {
              const lineUnits = unitsByLine.get(index) ?? [];
              return (
                <li key={index} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " +
                          (item.item_type === "phone" ? "bg-aqua text-accent" : "bg-peach text-coral")
                        }
                      >
                        {item.item_type === "phone" ? (
                          <Smartphone className="h-4 w-4" />
                        ) : (
                          <Headphones className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{item.description ?? "Item"}</p>
                        <p className="text-xs text-ink-muted">
                          {item.condition ? `${CONDITION_LABELS[item.condition] ?? item.condition} · ` : ""}
                          Qty {item.quantity ?? 0} × {formatMoney(item.unit_cost, currency)}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-ink sm:text-right">
                      {formatMoney(item.line_total, currency)}
                    </p>
                  </div>
                  {item.item_type === "phone" && lineUnits.length > 0 && <ImeiList units={lineUnits} />}
                </li>
              );
            })}
          </ul>
        )}

        {unassigned.size > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-sm font-semibold text-ink">Other IMEIs in this purchase</p>
            <ImeiList units={[...unassigned]} />
          </div>
        )}
      </section>

      <section className={cardClass}>
        <dl className="ml-auto max-w-sm space-y-1.5 text-sm">
          {[
            ["Subtotal", formatMoney(purchase.subtotal, currency)],
            ["Extra cost", formatMoney(purchase.extra_cost ?? 0, currency)],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-4 border-t border-line pt-1.5 text-base font-bold text-ink">
            <dt>Total</dt>
            <dd>{formatMoney(total, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Paid at purchase</dt>
            <dd className="text-ink">{formatMoney(paidAtPurchase, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Paid later</dt>
            <dd className="text-ink">{formatMoney(paidLater, currency)}</dd>
          </div>
          {returnedTotal > BigInt(0) && (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Returned to supplier</dt>
                <dd className="text-ink">-{formatMoney(returnedTotal, currency)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Money received back</dt>
                <dd className="text-ink">{formatMoney(refundedTotal, currency)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Total paid</dt>
            <dd className="font-semibold text-ink">{formatMoney(totalPaid, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4 font-semibold text-ink">
            <dt>Balance</dt>
            <dd>{formatMoney(balance, currency)}</dd>
          </div>
        </dl>
      </section>

      {canPay && balance !== null && (
        <section className={cardClass}>
          <PaySupplier
            key={centsToPlain(balance)}
            purchaseId={purchase.id}
            remaining={centsToPlain(balance)}
            currency={currency}
          />
        </section>
      )}

      <section className={cardClass}>
        <h2 className="mb-1 text-base font-bold text-ink">Payments</h2>
        <p className="mb-3 text-xs text-ink-muted">
          Paid later. The amount paid at purchase time is shown in the totals above.
        </p>
        {payments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
            No later payments yet.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="text-ink-muted">{formatDateTime(payment.created_at, timeZone)}</span>
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink">
                    {paymentMethodLabel(payment.method)} · Paid later
                  </span>
                  <span className="font-semibold text-ink">{formatMoney(payment.amount, currency)}</span>
                  {!cancelled && (canEditEntries || canDeleteEntries) && (
                    <PaymentActions
                      kind="supplier"
                      paymentId={payment.id}
                      amount={centsToPlain(toCents(payment.amount) ?? BigInt(0))}
                      method={payment.method ?? "cash"}
                      currency={currency}
                      canEdit={canEditEntries}
                      canDelete={canDeleteEntries}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EntryHistory types={["purchase"]} id={purchase.id} />
    </div>
  );
}
