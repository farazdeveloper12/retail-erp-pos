import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ExternalLink, Layers, Palette, Pencil } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import DeviceIllustration from "@/components/illustrations/DeviceIllustration";
import {
  BackLink,
  Notice,
  StatusPill,
  cardClass,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import {
  PRODUCT_TYPE_LABELS,
  UUID_PATTERN,
  formatVariant,
} from "@/lib/catalog";
import {
  ActiveToggle,
  AddColorForm,
  AddVariantForm,
  EditModelForm,
  type ModelForEdit,
} from "@/app/(app)/catalog/CatalogForms";

export const metadata: Metadata = {
  title: "Model details",
};

type ModelDetail = ModelForEdit & {
  is_active: boolean;
  brands: { name: string } | null;
  model_variants: {
    id: string;
    storage_gb: number;
    ram_gb: number | null;
    is_active: boolean;
  }[];
  model_colors: { id: string; name: string; is_active: boolean }[];
};

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof Layers;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-5 w-5 text-accent" />
      <h2 className="text-base font-bold text-ink">{children}</h2>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
      {children}
    </p>
  );
}

export default async function ModelPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  if (!id || !UUID_PATTERN.test(id)) {
    notFound();
  }

  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "catalog")) {
    return <AccessDenied />;
  }
  const canManage = permissions.includes("catalog.manage");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_models")
    .select(
      "*, brands(name), model_variants(id, storage_gb, ram_gb, is_active), model_colors(id, name, is_active)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <Notice kind="error">Could not load this model: {error.message}</Notice>
      </div>
    );
  }
  if (!data) {
    notFound();
  }

  const model = data as unknown as ModelDetail;

  const variants = [...model.model_variants].sort(
    (a, b) => a.storage_gb - b.storage_gb || (a.ram_gb ?? 0) - (b.ram_gb ?? 0)
  );
  const colors = [...model.model_colors].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const specs: [string, string | number | null][] = [
    ["Series", model.series],
    ["Release year", model.release_year],
    ["Display", model.display_info],
    ["Chipset", model.chipset],
    ["Camera", model.camera_info],
    ["Battery", model.battery_info],
    ["Operating system", model.os_info],
    ["Description", model.description],
  ];
  const shownSpecs = specs.filter(([, value]) => value !== null && value !== "");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <BackLink href="/catalog">Back to catalog</BackLink>

        <div className={cardClass + " flex flex-col gap-4 sm:flex-row sm:items-center"}>
          <div className="flex h-28 w-full shrink-0 items-center justify-center rounded-2xl bg-aqua sm:w-28">
            <DeviceIllustration kind={model.product_type} className="h-20 w-20" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {model.brands?.name ?? "No brand"} ·{" "}
              {PRODUCT_TYPE_LABELS[model.product_type] ?? model.product_type}
            </p>
            <h1 className="mt-0.5 text-2xl font-bold text-ink">{model.name}</h1>
            <div className="mt-2">
              <StatusPill active={model.is_active} />
            </div>
          </div>
          {canManage && (
            <ActiveToggle kind="model" id={model.id} active={model.is_active} />
          )}
        </div>
      </div>

      {/* Specifications */}
      <section className={cardClass}>
        <SectionTitle icon={Layers}>Specifications</SectionTitle>
        {shownSpecs.length === 0 && !model.spec_source ? (
          <EmptyLine>No specifications have been saved yet.</EmptyLine>
        ) : (
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {shownSpecs.map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-surface-muted px-4 py-3">
                <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
                <dd className="mt-0.5 text-ink">{value}</dd>
              </div>
            ))}
            {model.spec_source && (
              <div className="rounded-2xl bg-surface-muted px-4 py-3 sm:col-span-2">
                <dt className="text-xs font-semibold text-ink-muted">Source</dt>
                <dd className="mt-0.5 break-all">
                  <a
                    href={model.spec_source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-accent hover:text-accent-strong"
                  >
                    {model.spec_source}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                </dd>
              </div>
            )}
          </dl>
        )}

        {canManage && (
          <details className="group mt-5 border-t border-line pt-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-accent [&::-webkit-details-marker]:hidden">
              <Pencil className="h-4 w-4" />
              Edit specifications
            </summary>
            <div className="mt-4">
              <EditModelForm model={model} />
            </div>
          </details>
        )}
      </section>

      {/* Variants */}
      <section className={cardClass}>
        <SectionTitle icon={Layers}>Storage / RAM variants</SectionTitle>
        {variants.length === 0 ? (
          <EmptyLine>No variants yet.</EmptyLine>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {variants.map((variant) => (
              <li
                key={variant.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-surface-muted px-3 py-1 font-semibold text-ink">
                    {formatVariant(variant.storage_gb, variant.ram_gb)}
                  </span>
                  <StatusPill active={variant.is_active} />
                </span>
                {canManage && (
                  <ActiveToggle
                    kind="variant"
                    id={variant.id}
                    active={variant.is_active}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="mt-5 border-t border-line pt-5">
            <AddVariantForm modelId={model.id} />
          </div>
        )}
      </section>

      {/* Colors */}
      <section className={cardClass}>
        <SectionTitle icon={Palette}>Colors</SectionTitle>
        {colors.length === 0 ? (
          <EmptyLine>No colors yet.</EmptyLine>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {colors.map((color) => (
              <li
                key={color.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-surface-muted px-3 py-1 font-semibold text-ink">
                    {color.name}
                  </span>
                  <StatusPill active={color.is_active} />
                </span>
                {canManage && (
                  <ActiveToggle
                    kind="color"
                    id={color.id}
                    active={color.is_active}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {canManage && (
          <div className="mt-5 border-t border-line pt-5">
            <AddColorForm modelId={model.id} />
          </div>
        )}
      </section>
    </div>
  );
}
