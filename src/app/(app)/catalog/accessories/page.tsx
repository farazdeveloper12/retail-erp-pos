import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { BookOpen, Headphones, Pencil, Search, SearchX } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import {
  EmptyState,
  Notice,
  PageHeader,
  StatusPill,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canViewPage, getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import CatalogTabs from "@/app/(app)/catalog/CatalogTabs";
import {
  AccessoryActiveToggle,
  EditAccessoryForm,
  QuickAddForm,
  QuickFind,
} from "@/app/(app)/catalog/accessories/AccessoryForms";

export const metadata: Metadata = {
  title: "Accessories",
};

type ProductRow = {
  id: string;
  name: string;
  barcode: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  category_id: string | null;
  product_categories: { name: string } | null;
};

type Filters = { q: string; category: string; status: string };

const PAGE_SIZE = 200;
const PRODUCT_COLUMNS =
  "id, name, barcode, description, is_active, created_at, category_id, product_categories(name)";

// Same rules as the database read policy for products
const READ_PERMISSIONS = [
  "catalog.view",
  "inventory.view",
  "sales.create",
  "purchases.manage",
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

// Builds an accessories link that keeps the other filters
function pageHref(filters: Partial<Filters> & { edit?: string }) {
  const search = new URLSearchParams();
  if (filters.q) search.set("q", filters.q);
  if (filters.category) search.set("category", filters.category);
  if (filters.status && filters.status !== "active") {
    search.set("status", filters.status);
  }
  if (filters.edit) search.set("edit", filters.edit);
  const text = search.toString();
  return text ? `/catalog/accessories?${text}` : "/catalog/accessories";
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

export default async function AccessoriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    status?: string;
    edit?: string;
  }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "catalog")) {
    return <AccessDenied />;
  }
  const canCreate = hasAny(permissions, ["catalog.create", "catalog.manage"]);
  const canManage = permissions.includes("catalog.manage");
  const canRead = hasAny(permissions, READ_PERMISSIONS);

  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 100);
  const category =
    params.category === "none" || UUID_PATTERN.test(params.category ?? "")
      ? (params.category as string)
      : "";
  const status =
    params.status === "inactive" || params.status === "all"
      ? params.status
      : "active";
  const editId =
    canManage && UUID_PATTERN.test(params.edit ?? "") ? params.edit! : "";
  const filters: Filters = { q, category, status };

  const supabase = await createClient();

  const { data: categoryData } = await supabase
    .from("product_categories")
    .select("id, name, is_active")
    .order("name");
  const categories = (
    (categoryData ?? []) as { id: string; name: string; is_active: boolean }[]
  ).filter((c) => c.is_active);
  const categoryNames = categories.map((c) => c.name);

  let query = supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .order("name")
    .limit(PAGE_SIZE);

  const cleaned = q.replace(/[%_,()\\*]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned) query = query.ilike("name", `%${cleaned}%`);
  if (category === "none") query = query.is("category_id", null);
  else if (category) query = query.eq("category_id", category);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);

  const { data, error } = await query;
  const products = (data ?? []) as unknown as ProductRow[];
  const filtering = Boolean(cleaned || category || status !== "active");

  let editing: ProductRow | null = null;
  if (editId) {
    const { data: editData } = await supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("id", editId)
      .maybeSingle();
    editing = (editData as unknown as ProductRow | null) ?? null;
  }
  const closeHref = pageHref(filters);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={BookOpen}
        title="Product Catalog"
        description="Accessories and other items without an IMEI, such as chargers, cables, earbuds and cases."
      />

      <CatalogTabs active="accessories" />

      {canCreate && <QuickAddForm categories={categoryNames} />}

      {!canRead && (
        <Notice kind="error">
          Your account can add products but cannot view the product list. Ask the
          owner for catalog view access to see existing products.
        </Notice>
      )}

      {editing && (
        <section className={cardClass}>
          <h2 className="mb-4 text-base font-bold text-ink">
            Edit &quot;{editing.name}&quot;
          </h2>
          <EditAccessoryForm
            key={editing.id}
            product={{
              id: editing.id,
              name: editing.name,
              category: editing.product_categories?.name ?? "",
              barcode: editing.barcode ?? "",
              description: editing.description ?? "",
            }}
            categories={categoryNames}
            cancelHref={closeHref}
          />
        </section>
      )}

      {canRead && (
        <>
          {/* Search and filters */}
          <section className={cardClass + " space-y-4"}>
            <div>
              <p className={labelClass}>Quick find</p>
              <QuickFind canCreate={canCreate} />
            </div>

            <form
              method="get"
              className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end"
            >
              {category && <input type="hidden" name="category" value={category} />}
              <div className="flex-1">
                <label htmlFor="accessory-q" className={labelClass}>
                  Filter by name
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
                  <input
                    id="accessory-q"
                    name="q"
                    type="search"
                    defaultValue={q}
                    placeholder="Search accessories..."
                    className={inputClass + " pl-10"}
                  />
                </div>
              </div>
              <div className="sm:w-44">
                <label htmlFor="accessory-status" className={labelClass}>
                  Status
                </label>
                <select
                  id="accessory-status"
                  name="status"
                  defaultValue={status}
                  className={inputClass}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="all">All</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className={primaryButtonClass + " flex-1 sm:flex-none"}
                >
                  Search
                </button>
                {filtering && (
                  <Link
                    href="/catalog/accessories"
                    className={secondaryButtonClass + " flex-1 sm:flex-none"}
                  >
                    Clear
                  </Link>
                )}
              </div>
            </form>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">
                Categories
              </p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                <Chip href={pageHref({ q, status })} active={!category}>
                  All
                </Chip>
                {categories.map((c) => (
                  <Chip
                    key={c.id}
                    href={pageHref({ q, status, category: c.id })}
                    active={category === c.id}
                  >
                    {c.name}
                  </Chip>
                ))}
                <Chip
                  href={pageHref({ q, status, category: "none" })}
                  active={category === "none"}
                >
                  No category
                </Chip>
              </div>
            </div>
          </section>

          {/* Product list */}
          {error ? (
            <Notice kind="error">
              Could not load accessories: {error.message}
            </Notice>
          ) : products.length === 0 ? (
            filtering ? (
              <EmptyState
                icon={SearchX}
                title="No accessories match your filters"
                text="Try a different name, category or status."
                action={
                  <Link href="/catalog/accessories" className={secondaryButtonClass}>
                    Clear filters
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={Headphones}
                title="No accessories yet"
                text={
                  canCreate
                    ? "Use Quick add above to add your first item. Press Enter after each name."
                    : "Accessories will appear here once they are added."
                }
              />
            )
          ) : (
            <section aria-label="Accessories" className="space-y-3">
              <p className="text-sm text-ink-muted">
                {products.length} {products.length === 1 ? "item" : "items"}
                {products.length === PAGE_SIZE &&
                  ` (only the first ${PAGE_SIZE} are shown; narrow your search)`}
              </p>

              {/* Phone: cards */}
              <ul className="space-y-3 md:hidden">
                {products.map((product) => (
                  <li key={product.id} className={cardClass}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{product.name}</p>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          {product.product_categories?.name ?? "No category"}
                          {product.barcode ? ` · ${product.barcode}` : ""}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          Added {formatDate(product.created_at)}
                        </p>
                      </div>
                      <StatusPill active={product.is_active} />
                    </div>
                    {canManage && (
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <Link
                          href={pageHref({ ...filters, edit: product.id })}
                          className={secondaryButtonClass + " min-h-11 px-4 text-xs"}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Link>
                        <AccessoryActiveToggle
                          id={product.id}
                          active={product.is_active}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {/* Tablet and laptop: table */}
              <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th className="px-5 py-3">Name</th>
                      <th className="px-5 py-3">Category</th>
                      <th className="px-5 py-3">Barcode</th>
                      <th className="px-5 py-3">Added</th>
                      <th className="px-5 py-3">Status</th>
                      {canManage && (
                        <th className="px-5 py-3">
                          <span className="sr-only">Actions</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => (
                      <tr key={product.id} className="border-b border-line last:border-0">
                        <td className="px-5 py-3 font-semibold text-ink">
                          {product.name}
                        </td>
                        <td className="px-5 py-3">
                          {product.product_categories?.name ? (
                            <span className="rounded-full bg-aqua px-2.5 py-1 text-xs font-medium text-ink">
                              {product.product_categories.name}
                            </span>
                          ) : (
                            <span className="text-xs text-ink-muted">No category</span>
                          )}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-ink-muted">
                          {product.barcode ?? "—"}
                        </td>
                        <td className="px-5 py-3 text-ink-muted">
                          {formatDate(product.created_at)}
                        </td>
                        <td className="px-5 py-3">
                          <StatusPill active={product.is_active} />
                        </td>
                        {canManage && (
                          <td className="px-5 py-3">
                            <div className="flex items-start justify-end gap-2">
                              <Link
                                href={pageHref({ ...filters, edit: product.id })}
                                className={secondaryButtonClass + " min-h-11 px-4 text-xs"}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </Link>
                              <AccessoryActiveToggle
                                id={product.id}
                                active={product.is_active}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
