import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { toCsv } from "@/lib/csv";
import { categoryLabel, entryDescription, fetchLedger, parseLedgerFilters } from "@/lib/finance";

const PAGE = 1000;
const MAX_ROWS = 50000;

// GET /finance/export?account=&from=&to=&type=&q=  -> the filtered ledger as CSV
export async function GET(request: NextRequest) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "finance")) {
    return NextResponse.json({ error: "You do not have permission to export the ledger." }, { status: 403 });
  }

  const filters = parseLedgerFilters(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const supabase = await createClient();

  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { rows: batch, error } = await fetchLedger(supabase, filters, {
      limit: PAGE,
      offset,
      ascending: true,
    });
    if (error) return NextResponse.json({ error }, { status: 500 });
    for (const r of batch) {
      rows.push({
        date: r.entry_date,
        account: r.account_name,
        type: categoryLabel(r.category),
        description: entryDescription(r),
        money_in: r.direction === "in" ? r.amount : "",
        money_out: r.direction === "out" ? r.amount : "",
        account_balance: r.running_balance,
        cancelled: r.voided_at ? "yes" : "",
        recorded_at: r.created_at,
      });
    }
    if (batch.length < PAGE) break;
  }

  const name = `ledger-${filters.from}-to-${filters.to}.csv`;
  return new NextResponse(
    toCsv(rows, [
      "date",
      "account",
      "type",
      "description",
      "money_in",
      "money_out",
      "account_balance",
      "cancelled",
      "recorded_at",
    ]),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    }
  );
}
