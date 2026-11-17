import type { Metadata } from "next";
import Link from "next/link";
import { FileX } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import PrintButton from "@/components/PrintButton";
import { BackLink, EmptyState, Pill, cardClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { formatDateTime, formatDateWith, type DateFormat } from "@/lib/format";
import { todayInKarachi } from "@/lib/dashboard";
import { CLAIM_NEXT, claimStatusLabel, claimTone, formatClaimNo, type ClaimStatus } from "@/lib/returns";
import ClaimStatusForm from "@/app/(app)/returns/warranty/[id]/ClaimStatusForm";

export const metadata: Metadata = {
  title: "Warranty claim",
};

type ClaimRow = {
  id: string;
  claim_no: number;
  sale_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  item_description: string;
  imei: string | null;
  warranty_expires_on: string | null;
  under_warranty: boolean;
  issue: string;
  status: ClaimStatus;
  sent_to: string | null;
  resolution: string | null;
  received_on: string;
  sent_on: string | null;
  resolved_on: string | null;
  returned_on: string | null;
};

type EventRow = { id: string; status: string; note: string | null; created_at: string };

const INK = "text-[#1f2a2a]";
const MUTED = "text-[#5b6b6b]";
const LINE = "border-[#ece6d8]";

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const permissions = await getMyPermissions();
  if (!permissions.includes("returns.manage")) return <AccessDenied />;
  const { id } = await params;

  const notFound = (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/returns?tab=warranty">Warranty</BackLink>
      <EmptyState icon={FileX} title="Claim not found" text="This claim does not exist or you do not have access to it." />
    </div>
  );
  if (!UUID_PATTERN.test(id)) return notFound;

  const supabase = await createClient();
  const { data } = await supabase
    .from("warranty_claims")
    .select(
      "id, claim_no, sale_id, customer_name, customer_phone, item_description, imei, warranty_expires_on, under_warranty, issue, status, sent_to, resolution, received_on, sent_on, resolved_on, returned_on"
    )
    .eq("id", id)
    .maybeSingle();
  const claim = data as ClaimRow | null;
  if (!claim) return notFound;

  const canSeeSuppliers = permissions.some((p) =>
    ["suppliers.view", "suppliers.manage", "purchases.view", "purchases.manage"].includes(p)
  );
  const [{ data: eventData }, business, { data: supplierData }] = await Promise.all([
    supabase.from("warranty_claim_events").select("id, status, note, created_at").eq("claim_id", id).order("created_at"),
    getMyBusiness(),
    canSeeSuppliers
      ? supabase.from("suppliers").select("id, name").eq("is_active", true).order("name").limit(200)
      : Promise.resolve({ data: [] }),
  ]);
  const events = (eventData ?? []) as EventRow[];
  const dateFormat = (business?.date_format ?? "medium") as DateFormat;
  const next = CLAIM_NEXT[claim.status] ?? [];
  const showLogo = Boolean(business?.invoice_show_logo && business?.logo_url);

  const rows: [string, string][] = [
    ["Item", claim.item_description],
    ["IMEI", claim.imei ?? "—"],
    ["Customer", claim.customer_name || "—"],
    ["Phone", claim.customer_phone || "—"],
    ["Received", formatDateWith(claim.received_on, dateFormat)],
    [
      "Warranty",
      claim.warranty_expires_on
        ? `${claim.under_warranty ? "Under warranty" : "Outside warranty"} (until ${formatDateWith(claim.warranty_expires_on, dateFormat)})`
        : claim.under_warranty
          ? "Under warranty"
          : "Outside warranty",
    ],
  ];
  if (claim.sent_to) rows.push(["Sent to", `${claim.sent_to}${claim.sent_on ? ` on ${formatDateWith(claim.sent_on, dateFormat)}` : ""}`]);
  const result = [...events].reverse().find((e) => ["repaired", "replaced", "rejected"].includes(e.status));
  if (claim.resolved_on && result) {
    rows.push(["Result", `${claimStatusLabel(result.status)} on ${formatDateWith(claim.resolved_on, dateFormat)}`]);
  }
  if (claim.returned_on) rows.push(["Handed back", formatDateWith(claim.returned_on, dateFormat)]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <BackLink href="/returns?tab=warranty">Warranty</BackLink>
        <div className="flex flex-wrap gap-2">
          {claim.sale_id && (
            <Link
              href={`/sales/${claim.sale_id}`}
              className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink"
            >
              Open invoice
            </Link>
          )}
          <PrintButton label="Print slip" />
        </div>
      </div>

      {/* Printable claim slip */}
      <article className={`rounded-card border bg-white p-6 shadow-soft sm:p-8 print:border-0 print:p-0 print:shadow-none ${LINE} ${INK}`}>
        <header className={`flex flex-wrap items-start justify-between gap-4 border-b pb-4 ${LINE}`}>
          <div className="flex items-start gap-3">
            {showLogo && (
              // eslint-disable-next-line @next/next/no-img-element -- the logo lives in Supabase Storage
              <img src={business!.logo_url!} alt="" className="h-14 w-14 object-contain" />
            )}
            <div>
              <p className="text-xl font-bold">{business?.name || "Retail workspace"}</p>
              {business?.phone && <p className={`text-sm ${MUTED}`}>{business.phone}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-bold tracking-widest">WARRANTY CLAIM</p>
            <p className="font-mono text-sm font-semibold">{formatClaimNo(claim.claim_no)}</p>
            <p className={`text-sm ${MUTED}`}>{claimStatusLabel(claim.status)}</p>
          </div>
        </header>
        <dl className="grid gap-x-6 gap-y-2 py-4 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className={`text-xs uppercase tracking-wide ${MUTED}`}>{label}</dt>
              <dd className="font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        <div className={`border-t pt-3 text-sm ${LINE}`}>
          <p className={`text-xs uppercase tracking-wide ${MUTED}`}>Problem</p>
          <p className="whitespace-pre-line">{claim.issue}</p>
          {claim.resolution && (
            <>
              <p className={`mt-3 text-xs uppercase tracking-wide ${MUTED}`}>Result</p>
              <p className="whitespace-pre-line">{claim.resolution}</p>
            </>
          )}
        </div>
        <p className={`mt-6 text-xs ${MUTED}`}>
          Please bring this slip when you collect the item.
        </p>
        <footer className={`mt-8 grid grid-cols-2 gap-6 text-xs ${MUTED}`}>
          <p className="border-t border-dashed border-[#5b6b6b] pt-1">Customer signature</p>
          <p className="border-t border-dashed border-[#5b6b6b] pt-1">Shop signature</p>
        </footer>
      </article>

      {next.length > 0 && (
        <ClaimStatusForm
          claimId={claim.id}
          next={next}
          suppliers={(supplierData ?? []) as { id: string; name: string }[]}
          today={todayInKarachi()}
        />
      )}

      <section className={cardClass + " print:hidden"} aria-labelledby="history-title">
        <h2 id="history-title" className="mb-3 text-base font-bold text-ink">
          History
        </h2>
        <ol className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <Pill tone={claimTone(e.status)}>{claimStatusLabel(e.status)}</Pill>
                {e.note && <span className="text-ink-muted">{e.note}</span>}
              </span>
              <span className="text-xs text-ink-muted">{formatDateTime(e.created_at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
