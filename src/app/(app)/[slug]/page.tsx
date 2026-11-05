import { notFound } from "next/navigation";
import { Hammer } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { navItems } from "@/lib/navigation";
import { canViewPage, getMyPermissions } from "@/lib/permissions";

export default async function ModulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const item = navItems.find((n) => n.slug === slug && n.slug !== "");

  if (!item) {
    notFound();
  }

  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, item.slug)) {
    return <AccessDenied />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
          <item.icon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{item.label}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {item.description}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
        <Hammer className="mx-auto h-8 w-8 text-slate-400" />
        <p className="mt-3 font-medium">Ye module abhi bana nahi</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {item.phase} mein is ko asli functionality ke saath banayenge.
        </p>
      </div>
    </div>
  );
}