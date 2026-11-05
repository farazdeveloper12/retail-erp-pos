import AccessDenied from "@/components/AccessDenied";
import { canViewPage, getMyPermissions } from "@/lib/permissions";

type Card = {
  label: string;
  phase: string;
  requires?: string; // Ye ijazat ho to hi card dikhe
};

const kpis: Card[] = [
  { label: "Today's Sales", phase: "Phase 8" },
  { label: "Today's Purchases", phase: "Phase 7", requires: "dashboard.financial" },
  { label: "Today's Gross Profit", phase: "Phase 12", requires: "dashboard.financial" },
  { label: "Today's Net Profit", phase: "Phase 12", requires: "dashboard.financial" },
  { label: "Monthly Sales", phase: "Phase 8" },
  { label: "Monthly Profit", phase: "Phase 12", requires: "dashboard.financial" },
  { label: "Inventory Value", phase: "Phase 6", requires: "dashboard.financial" },
  { label: "Phones in Stock", phase: "Phase 6" },
  { label: "Accessories in Stock", phase: "Phase 6" },
  { label: "Customer Receivables", phase: "Phase 10" },
  { label: "Supplier Payables", phase: "Phase 10", requires: "dashboard.financial" },
  { label: "Total Expenses", phase: "Phase 11", requires: "dashboard.financial" },
  { label: "Cash in Hand", phase: "Phase 11", requires: "dashboard.financial" },
  { label: "Bank Balance", phase: "Phase 11", requires: "dashboard.financial" },
];

const panels: Card[] = [
  { label: "Low-Stock Alerts", phase: "Phase 6", requires: "inventory.view" },
  { label: "Out-of-Stock Alerts", phase: "Phase 6", requires: "inventory.view" },
  { label: "Recent Transactions", phase: "Phase 8", requires: "sales.view_own" },
  { label: "Best-Selling Products", phase: "Phase 14", requires: "reports.basic" },
  { label: "Sales by Employee", phase: "Phase 14", requires: "sales.view_all" },
];

export default async function DashboardPage() {
  const permissions = await getMyPermissions();

  if (!canViewPage(permissions, "")) {
    return <AccessDenied />;
  }

  const visibleKpis = kpis.filter(
    (k) => !k.requires || permissions.includes(k.requires)
  );
  const visiblePanels = panels.filter(
    (p) => !p.requires || permissions.includes(p.requires)
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Karobar ka poora khulasa ek nazar mein.
        </p>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
        Ye abhi sirf design ka khaka hai. Neeche &quot;—&quot; ka matlab hai ke
        data abhi database se connected nahi. Asli figures sirf tab dikhengi
        jab related module bana kar test ho jaye.
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {visibleKpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {kpi.label}
            </p>
            <p className="mt-2 text-2xl font-semibold">—</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              {kpi.phase} mein connect hoga
            </p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {visiblePanels.map((panel) => (
          <div
            key={panel.label}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="font-semibold">{panel.label}</h2>
            <p className="mt-6 pb-6 text-center text-sm text-slate-400 dark:text-slate-500">
              Abhi koi data nahi ({panel.phase} mein aayega)
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}