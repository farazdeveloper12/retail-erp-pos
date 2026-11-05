const kpis = [
  { label: "Today's Sales", phase: "Phase 8" },
  { label: "Today's Purchases", phase: "Phase 7" },
  { label: "Today's Gross Profit", phase: "Phase 12" },
  { label: "Today's Net Profit", phase: "Phase 12" },
  { label: "Monthly Sales", phase: "Phase 8" },
  { label: "Monthly Profit", phase: "Phase 12" },
  { label: "Inventory Value", phase: "Phase 6" },
  { label: "Phones in Stock", phase: "Phase 6" },
  { label: "Accessories in Stock", phase: "Phase 6" },
  { label: "Customer Receivables", phase: "Phase 10" },
  { label: "Supplier Payables", phase: "Phase 10" },
  { label: "Total Expenses", phase: "Phase 11" },
  { label: "Cash in Hand", phase: "Phase 11" },
  { label: "Bank Balance", phase: "Phase 11" },
];

const panels = [
  { title: "Low-Stock Alerts", phase: "Phase 6" },
  { title: "Out-of-Stock Alerts", phase: "Phase 6" },
  { title: "Recent Transactions", phase: "Phase 8" },
  { title: "Best-Selling Products", phase: "Phase 14" },
  { title: "Sales by Employee", phase: "Phase 14" },
];

export default function DashboardPage() {
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
        {kpis.map((kpi) => (
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
        {panels.map((panel) => (
          <div
            key={panel.title}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <h2 className="font-semibold">{panel.title}</h2>
            <p className="mt-6 pb-6 text-center text-sm text-slate-400 dark:text-slate-500">
              Abhi koi data nahi ({panel.phase} mein aayega)
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}