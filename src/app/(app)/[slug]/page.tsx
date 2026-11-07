import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
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
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-soft">
          <item.icon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-ink">{item.label}</h1>
          <p className="text-sm text-ink-muted">{item.description}</p>
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface px-6 py-12 text-center shadow-soft">
        {/* Illustration-style icon */}
        <div className="relative mx-auto h-24 w-24">
          <div className="absolute inset-0 rounded-full bg-aqua" />
          <div className="absolute inset-4 flex items-center justify-center rounded-3xl border-2 border-ink bg-surface">
            <item.icon className="h-8 w-8 text-accent" />
          </div>
          <div className="absolute -right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-pill text-pill-ink shadow-soft">
            <Sparkles className="h-4 w-4" />
          </div>
        </div>
        <p className="mt-5 text-lg font-bold text-ink">Coming soon</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
          We are building {item.label}. It will appear here as soon as it is
          ready.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-5 text-sm font-semibold text-ink hover:bg-surface-muted"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
