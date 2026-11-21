import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions } from "@/lib/permissions";
import { EXPORT_TABLES } from "@/lib/backup";
import { toCsv } from "@/lib/csv";
import { todayIn } from "@/lib/dashboard";
import { getBusinessTimeZone } from "@/lib/business";

const PAGE = 1000;
const MAX_ROWS = 200000;

type Row = Record<string, unknown>;

async function readAll(table: string): Promise<{ rows: Row[]; error: string | null }> {
  const supabase = await createClient();
  const rows: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows, error: null };
}

// GET /settings/export?table=<name>  -> one table as CSV
// GET /settings/export?table=all     -> every table as one JSON file
export async function GET(request: NextRequest) {
  const permissions = await getMyPermissions();
  if (!permissions.includes("settings.manage")) {
    return NextResponse.json({ error: "You do not have permission to export data." }, { status: 403 });
  }

  const table = request.nextUrl.searchParams.get("table") ?? "";
  const timeZone = await getBusinessTimeZone();
  const date = todayIn(timeZone);

  if (table === "all") {
    const result: Record<string, Row[] | { error: string }> = {};
    for (const name of EXPORT_TABLES) {
      const { rows, error } = await readAll(name);
      result[name] = error ? { error } : rows;
    }
    const body = JSON.stringify({ exported_at: new Date().toISOString(), tables: result }, null, 2);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="backup-${date}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (!(EXPORT_TABLES as readonly string[]).includes(table)) {
    return NextResponse.json({ error: "Unknown table." }, { status: 400 });
  }

  const { rows, error } = await readAll(table);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${table}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
