import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
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
  title: "Model ki tafseel",
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

const cardClass =
  "rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900";

function Badge({ active }: { active: boolean }) {
  return (
    <span
      className={
        "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium " +
        (active
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
          : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300")
      }
    >
      {active ? "Active" : "Band"}
    </span>
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
      <div
        role="alert"
        className="mx-auto max-w-3xl rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
      >
        Model nahi mil saka: {error.message}
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
    ["Launch ka saal", model.release_year],
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
        <Link
          href="/catalog"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Catalog par wapas
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">
              {model.brands?.name} {model.name}
            </h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              {PRODUCT_TYPE_LABELS[model.product_type] ?? model.product_type}
              <Badge active={model.is_active} />
            </p>
          </div>
          {canManage && (
            <ActiveToggle kind="model" id={model.id} active={model.is_active} />
          )}
        </div>
      </div>

      {/* Maloomat */}
      <section className={cardClass}>
        <h2 className="font-semibold">Maloomat</h2>
        {shownSpecs.length === 0 && !model.spec_source ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Abhi koi specification save nahi hui.
          </p>
        ) : (
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {shownSpecs.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  {label}
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
            {model.spec_source && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">
                  Source
                </dt>
                <dd className="break-all">
                  <a
                    href={model.spec_source}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {model.spec_source}
                  </a>
                </dd>
              </div>
            )}
          </dl>
        )}

        {canManage && (
          <details className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <summary className="cursor-pointer text-sm font-semibold">
              Maloomat edit karein
            </summary>
            <div className="mt-4">
              <EditModelForm model={model} />
            </div>
          </details>
        )}
      </section>

      {/* Variants */}
      <section className={cardClass}>
        <h2 className="font-semibold">Storage / RAM variants</h2>
        {variants.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Abhi koi variant nahi.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {variants.map((variant) => (
              <li
                key={variant.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  {formatVariant(variant.storage_gb, variant.ram_gb)}
                  <Badge active={variant.is_active} />
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
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <AddVariantForm modelId={model.id} />
          </div>
        )}
      </section>

      {/* Colors */}
      <section className={cardClass}>
        <h2 className="font-semibold">Colors</h2>
        {colors.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Abhi koi color nahi.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {colors.map((color) => (
              <li
                key={color.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  {color.name}
                  <Badge active={color.is_active} />
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
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <AddColorForm modelId={model.id} />
          </div>
        )}
      </section>
    </div>
  );
}