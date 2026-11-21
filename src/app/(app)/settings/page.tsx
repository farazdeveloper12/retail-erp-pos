import type { Metadata } from "next";
import Link from "next/link";
import {
  ShieldCheck,
  Boxes,
  Database,
  Download,
  ImageIcon,
  Globe,
  History,
  Landmark,
  Receipt,
  Settings,
  Store,
  Tags,
  UserCog,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import AccessDenied from "@/components/AccessDenied";
import { Notice, PageHeader, cardClass, secondaryButtonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { EXPORT_TABLES } from "@/lib/backup";
import SettingsForm from "@/app/(app)/settings/SettingsForm";
import {
  ExpenseCategoriesManager,
  InvoiceSettingsForm,
  LogoForm,
  ProductCategoriesManager,
  StockSettingsForm,
  TaxRegionSettingsForm,
  WarrantyDefaultsForm,
} from "@/app/(app)/settings/PreferencesForms";

export const metadata: Metadata = {
  title: "Settings",
};

const SECTIONS = [
  { id: "shop", label: "Shop profile" },
  { id: "tax", label: "Tax & plan" },
  { id: "invoice", label: "Invoice" },
  { id: "warranty", label: "Warranty" },
  { id: "stock", label: "Stock" },
  { id: "expenses", label: "Expense categories" },
  { id: "products", label: "Product categories" },
  { id: "payments", label: "Payment accounts" },
  { id: "backup", label: "Data backup" },
];

function Section({
  id,
  icon: Icon,
  title,
  description,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cardClass + " scroll-mt-28"}>
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-aqua text-accent">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-ink">{title}</h2>
          {description && <p className="text-sm text-ink-muted">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function tableLabel(name: string) {
  return name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default async function SettingsPage() {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "settings")) {
    return <AccessDenied />;
  }

  const business = await getMyBusiness();
  const supabase = await createClient();
  const canManageCatalog = permissions.includes("catalog.manage");

  const [{ data: expenseCategories }, { data: productCategories }] = await Promise.all([
    supabase.from("expense_categories").select("id, name, is_active").order("name"),
    canManageCatalog
      ? supabase.from("product_categories").select("id, name, is_active").order("name")
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          icon={Settings}
          title="Settings"
          description="Business details, invoices, stock and data used across the app."
        />
        <div className="flex flex-wrap gap-2">
          <Link href="/settings/history" className={secondaryButtonClass}>
            <History className="h-4 w-4" />
            Edit &amp; delete history
          </Link>
          <Link href="/settings/account" className={secondaryButtonClass}>
            <UserCog className="h-4 w-4" />
            My account
          </Link>
        </div>
      </div>

      <nav aria-label="Settings sections" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink-muted hover:text-ink"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {!business ? (
        <Notice kind="error">No business is linked to your account, so settings cannot be shown.</Notice>
      ) : (
        <>
          <Section id="shop" icon={Store} title="Shop profile" description="Shown in the sidebar, the browser tab and on invoices.">
            <SettingsForm
              defaults={{
                name: business.name ?? "",
                legal_name: business.legal_name ?? "",
                region: business.region ?? "PK",
                phone: business.phone ?? "",
                email: business.email ?? "",
                address: business.address ?? "",
              }}
            />
            <div className="mt-6 border-t border-line pt-5">
              <p className="mb-3 flex items-center gap-2 text-sm font-bold text-ink">
                <ImageIcon className="h-4 w-4 text-accent" />
                Logo
              </p>
              <LogoForm logoUrl={business.logo_url} />
            </div>
          </Section>

          <Section
            id="tax"
            icon={Globe}
            title={business.region === "AE" ? "Tax & plan" : "Plan"}
            description={
              business.region === "AE"
                ? "VAT, Tax Registration Number, invoice language and the plan of this business."
                : "The plan of this business. Pakistan has no VAT fields."
            }
          >
            <TaxRegionSettingsForm
              region={business.region === "AE" ? "AE" : "PK"}
              defaults={{
                vat_enabled: business.vat_enabled ?? false,
                // A VAT rate of 5% is suggested until a rate is saved
                tax_rate:
                  business.tax_rate === null || business.tax_rate === undefined || Number(business.tax_rate) <= 0
                    ? "5"
                    : String(business.tax_rate),
                trn: business.trn ?? "",
                name_ar: business.name_ar ?? "",
                address_ar: business.address_ar ?? "",
                invoice_language: business.invoice_language ?? "en",
                plan: business.plan ?? "full",
              }}
            />
          </Section>

          <Section id="invoice" icon={Receipt} title="Invoice" description="Paper size, fields and text printed on invoices.">
            <InvoiceSettingsForm
              defaults={{
                invoice_paper: business.invoice_paper,
                date_format: business.date_format,
                invoice_footer: business.invoice_footer ?? "",
                warranty_terms: business.warranty_terms ?? "",
                invoice_show_logo: business.invoice_show_logo,
                invoice_show_customer_phone: business.invoice_show_customer_phone,
                invoice_show_warranty: business.invoice_show_warranty,
                invoice_show_payment_method: business.invoice_show_payment_method,
              }}
            />
          </Section>

          <Section
            id="warranty"
            icon={ShieldCheck}
            title="Default warranty"
            description="Days of warranty filled in on new sale lines. Separate for phones and accessories."
          >
            <WarrantyDefaultsForm
              phoneDays={business.default_warranty_phone_days ?? null}
              accessoryDays={business.default_warranty_accessory_days ?? null}
            />
          </Section>

          <Section id="stock" icon={Boxes} title="Stock">
            <StockSettingsForm threshold={business.low_stock_threshold} />
          </Section>

          <Section
            id="expenses"
            icon={Tags}
            title="Expense categories"
            description="Suggested in the expense form. Deactivated categories are no longer suggested."
          >
            <ExpenseCategoriesManager
              categories={(expenseCategories ?? []) as { id: string; name: string; is_active: boolean }[]}
            />
          </Section>

          <Section id="products" icon={Tags} title="Product categories" description="Categories used for accessories.">
            {canManageCatalog ? (
              <ProductCategoriesManager
                categories={(productCategories ?? []) as { id: string; name: string; is_active: boolean }[]}
              />
            ) : (
              <p className="text-sm text-ink-muted">You need catalog permission to change product categories.</p>
            )}
          </Section>

          <Section
            id="payments"
            icon={Landmark}
            title="Payment accounts"
            description="Cash, bank and wallet accounts (such as JazzCash or Easypaisa) with their opening balances."
          >
            <Link href="/finance" className={secondaryButtonClass}>
              <Landmark className="h-4 w-4" />
              Manage accounts on the Cash &amp; Bank page
            </Link>
          </Section>

          <Section
            id="backup"
            icon={Database}
            title="Data backup"
            description="Download your shop data. Files can be opened in Excel or kept as a backup."
          >
            {/* A plain link: this is a file download from a route handler, not a page */}
            <a href="/settings/export?table=all" className={secondaryButtonClass}>
              <Download className="h-4 w-4" />
              Download everything (JSON)
            </a>
            <div className="mt-4 flex flex-wrap gap-2">
              {EXPORT_TABLES.map((table) => (
                <a
                  key={table}
                  href={`/settings/export?table=${table}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-semibold text-ink hover:bg-surface-muted"
                >
                  <Download className="h-3.5 w-3.5" />
                  {tableLabel(table)} (CSV)
                </a>
              ))}
            </div>
            <p className="mt-4 rounded-2xl bg-surface-muted px-4 py-3 text-xs text-ink-muted">
              This download is a copy of your data for your own records. It is not a full database backup:
              Supabase keeps its own automatic backups separately (see your Supabase project, Database &gt;
              Backups), and restoring data from these files is not done from inside the app.
            </p>
          </Section>
        </>
      )}
    </div>
  );
}
