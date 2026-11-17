import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, EmptyState, Notice, PageHeader, Pill, StatusPill, cardClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { formatDateWith, type DateFormat } from "@/lib/format";
import { todayInKarachi } from "@/lib/dashboard";
import { accountKindLabel, fetchAccounts } from "@/lib/finance";
import { AccountActions, NewAccountForm } from "@/app/(app)/finance/accounts/AccountForms";

export const metadata: Metadata = {
  title: "Accounts",
};

export default async function FinanceAccountsPage() {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "finance")) {
    return <AccessDenied />;
  }
  const canManage = permissions.includes("finance.manage");

  const supabase = await createClient();
  const [business, { accounts, error }] = await Promise.all([getMyBusiness(), fetchAccounts(supabase)]);
  const currency = business?.currency_code || "PKR";
  const dateFormat = (business?.date_format ?? "medium") as DateFormat;
  const today = todayInKarachi();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/finance">Cash &amp; Bank</BackLink>
      <PageHeader
        icon={Landmark}
        title="Accounts"
        description="Cash, bank and wallet accounts. The default cash and default bank accounts receive the cash and bank payments of sales, purchases and expenses."
      />

      {canManage && <NewAccountForm today={today} currency={currency} />}
      {error && <Notice kind="error">Could not load accounts: {error}</Notice>}

      {accounts.length === 0 && !error ? (
        <EmptyState
          icon={Landmark}
          title="No accounts yet"
          text="The database update creates a default cash and bank account. Add wallets such as JazzCash or Easypaisa here."
        />
      ) : (
        <ul className="space-y-3">
          {accounts.map((a) => (
            <li key={a.id} className={cardClass + (a.is_active ? "" : " opacity-75")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-base font-bold text-ink">
                    {a.name}
                    <Pill tone="teal">{accountKindLabel(a.kind)}</Pill>
                    {a.is_default && <Pill tone="purple">Default {a.kind}</Pill>}
                    <StatusPill active={a.is_active} />
                  </p>
                  {a.details && <p className="mt-1 text-sm text-ink-muted">{a.details}</p>}
                  <p className="mt-1 text-xs text-ink-muted">
                    Opening {formatMoney(a.opening_balance, currency)} on {formatDateWith(a.opening_date, dateFormat)} ·{" "}
                    {a.entry_count} {Number(a.entry_count) === 1 ? "entry" : "entries"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-ink-muted">Balance</p>
                  <p className="text-xl font-bold text-ink">{formatMoney(a.balance, currency)}</p>
                </div>
              </div>
              {canManage && (
                <div className="mt-4 border-t border-line pt-4">
                  <AccountActions
                    account={{
                      id: a.id,
                      name: a.name,
                      kind: a.kind,
                      details: a.details,
                      opening_balance: String(a.opening_balance),
                      opening_date: a.opening_date,
                      is_default: a.is_default,
                      is_active: a.is_active,
                    }}
                    today={today}
                    currency={currency}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
