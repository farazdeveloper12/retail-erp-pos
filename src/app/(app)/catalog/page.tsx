import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpen, Plus, Search, SearchX, Tag } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import DeviceIllustration from "@/components/illustrations/DeviceIllustration";
import {
  EmptyState,
  Notice,
  PageHeader,
  Pill,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import {
  PRODUCT_TYPE_LABELS,
  UUID_PATTERN,
  formatVariant,
} from "@/lib/catalog";
import { AddBrandForm } from "@/app/(app)/catalog/CatalogForms";

export const metadata: Metadata = {
  title: "Product Catalog",
};

type ModelRow = {
  id: string;
  name: string;
  product_type: string;
  is_active: boolean;
  brands: { name: string } | null;
  model_variants: { storage_gb: number; ram_gb: number | null; is_active: boolean }[];
  model_colors: { is_active: boolean }[];
};

const PAGE_SIZE = 200;

// Pastel tile backgrounds, picked by position so the grid feels varied
const TILE_TONES = ["bg-aqua", "bg-peach", "bg-lavender", "bg-mint"];

// Builds a /catalog link that keeps the other filters
function catalogHref(params: { q?: string; brand?: string; type?: string }) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.brand) search.set("brand", params.brand);
  if (params.type) search.set("type", params.type);
  const text = search.toString();
  return text ? `/catalog?${text}` : "/catalog";
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={
        "inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors " +
        (active
          ? "bg-pill text-pill-ink shadow-soft"
          : "border border-line bg-surface text-ink-muted hover:text-ink")
      }
    >
      {children}
    </Link>
  );
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; brand?: string; type?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "catalog")) {
    return <AccessDenied />;
  }
  const canManage = permissions.includes("catalog.manage");

  const { q = "", brand = "", type = "" } = await searchParams;
  const supabase = await createClient();

  const { data: brandData } = await supabase
    .from("brands")
    .select("id, name")
    .order("name");
  const brands = (brandData ?? []) as { id: string; name: string }[];

  let query = supabase
    .from("product_models")
    .select(
      "id, name, product_type, is_active, brands(name), model_variants(storage_gb, ram_gb, is_active), model_colors(is_active)"
    )
    .order("name")
    .limit(PAGE_SIZE);

  const cleaned = q.replace(/[%_,()\\*]/g, " ").trim();
  if (cleaned) query = query.ilike("name", `%${cleaned}%`);
  if (UUID_PATTERN.test(brand)) query = query.eq("brand_id", brand);
  if (type === "phone" || type === "smartwatch") {
    query = query.eq("product_type", type);
  }

  const { data, error } = await query;
  const models = (data ?? []) as unknown as ModelRow[];
  const filtering = Boolean(cleaned || UUID_PATTERN.test(brand) || type);
  const activeBrand = UUID_PATTERN.test(brand) ? brand : "";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={BookOpen}
        title="Product Catalog"
        description="A searchable list of phone and smartwatch models."
        action={
          canManage && (
            <Link href="/catalog/new" className={primaryButtonClass}>
              <Plus className="h-4 w-4" />
              New model
            </Link>
          )
        }
      />

      {/* Search and filters */}
      <section className={cardClass + " space-y-4"}>
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {activeBrand && <input type="hidden" name="brand" value={activeBrand} />}
          <div className="flex-1">
            <label htmlFor="q" className={labelClass}>
              Model name
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={q}
                placeholder="Search models..."
                className={inputClass + " pl-10"}
              />
            </div>
          </div>
          <div className="sm:w-44">
            <label htmlFor="type" className={labelClass}>
              Type
            </label>
            <select id="type" name="type" defaultValue={type} className={inputClass}>
              <option value="">All types</option>
              <option value="phone">Phone</option>
              <option value="smartwatch">Smartwatch</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className={primaryButtonClass + " flex-1 sm:flex-none"}>
              Search
            </button>
            {filtering && (
              <Link href="/catalog" className={secondaryButtonClass + " flex-1 sm:flex-none"}>
                Clear
              </Link>
            )}
          </div>
        </form>

        {brands.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">
              Brands
            </p>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              <Chip href={catalogHref({ q, type })} active={!activeBrand}>
                All brands
              </Chip>
              {brands.map((b) => (
                <Chip
                  key={b.id}
                  href={catalogHref({ q, brand: b.id, type })}
                  active={activeBrand === b.id}
                >
                  {b.name}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </section>

      {error ? (
        <Notice kind="error">Could not load the catalog: {error.message}</Notice>
      ) : models.length === 0 ? (
        filtering ? (
          <EmptyState
            icon={SearchX}
            title="No models match your search"
            text="Try a different name, brand or type."
            action={
              <Link href="/catalog" className={secondaryButtonClass}>
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={BookOpen}
            title="Your catalog is empty"
            text="Verified model data will be added later. You can also add models yourself."
            action={
              canManage && (
                <Link href="/catalog/new" className={primaryButtonClass}>
                  <Plus className="h-4 w-4" />
                  Add the first model
                </Link>
              )
            }
          />
        )
      ) : (
        <section aria-label="Models" className="space-y-3">
          <p className="text-sm text-ink-muted">
            {models.length} {models.length === 1 ? "model" : "models"}
            {models.length === PAGE_SIZE &&
              ` (only the first ${PAGE_SIZE} are shown; narrow your search)`}
          </p>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {models.map((model, index) => {
              const variants = model.model_variants
                .filter((v) => v.is_active)
                .sort(
                  (a, b) =>
                    a.storage_gb - b.storage_gb ||
                    (a.ram_gb ?? 0) - (b.ram_gb ?? 0)
                );
              const shown = variants.slice(0, 3);
              const extra = variants.length - shown.length;
              const colorCount = model.model_colors.filter(
                (c) => c.is_active
              ).length;

              return (
                <li key={model.id}>
                  <Link
                    href={`/catalog/model?id=${model.id}`}
                    className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-soft transition hover:-translate-y-0.5 hover:border-line-strong"
                  >
                    <div
                      className={
                        "relative flex h-36 items-center justify-center " +
                        TILE_TONES[index % TILE_TONES.length]
                      }
                    >
                      <DeviceIllustration
                        kind={model.product_type}
                        className="h-24 w-24 transition group-hover:scale-105"
                      />
                      <span className="absolute left-3 top-3">
                        <Pill tone={model.is_active ? "mint" : "coral"}>
                          {model.is_active ? "Active" : "Inactive"}
                        </Pill>
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                          {model.brands?.name ?? "No brand"} ·{" "}
                          {PRODUCT_TYPE_LABELS[model.product_type] ??
                            model.product_type}
                        </p>
                        <p className="mt-0.5 text-base font-bold text-ink">
                          {model.name}
                        </p>
                      </div>
                      <div className="mt-auto flex flex-wrap gap-1.5">
                        {shown.length === 0 ? (
                          <span className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-ink-muted">
                            No variants yet
                          </span>
                        ) : (
                          shown.map((v) => (
                            <span
                              key={`${v.storage_gb}-${v.ram_gb}`}
                              className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink"
                            >
                              {formatVariant(v.storage_gb, v.ram_gb)}
                            </span>
                          ))
                        )}
                        {extra > 0 && (
                          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted">
                            +{extra} more
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink-muted">
                          <Tag className="h-3 w-3" />
                          {colorCount === 0
                            ? "No colors"
                            : `${colorCount} ${colorCount === 1 ? "color" : "colors"}`}
                        </span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {canManage && (
        <details className={cardClass + " group"}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-base font-bold text-ink [&::-webkit-details-marker]:hidden">
            Add a new brand
            <Plus className="h-5 w-5 text-ink-muted transition-transform group-open:rotate-45" />
          </summary>
          <div className="mt-4">
            <AddBrandForm />
          </div>
        </details>
      )}
    </div>
  );
}
