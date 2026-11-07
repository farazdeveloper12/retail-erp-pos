"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import { CheckCircle2, ChevronDown, Info, Zap } from "lucide-react";
import ProductPicker from "@/components/ProductPicker";
import {
  createAccessory,
  setAccessoryActive,
  updateAccessory,
  type AccessoryFormState,
} from "@/app/(app)/catalog/accessories/actions";
import {
  Notice,
  cardClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";

type RecentItem = {
  key: number;
  name: string;
  category: string | null;
  existing: boolean;
};

const initialFormState: AccessoryFormState = { error: null, success: null };

function CategoryOptions({ id, names }: { id: string; names: string[] }) {
  return (
    <datalist id={id}>
      {names.map((name) => (
        <option key={name} value={name} />
      ))}
    </datalist>
  );
}

// Fast "Excel-like" entry: type, press Enter, type the next one.
export function QuickAddForm({ categories }: { categories: string[] }) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [barcode, setBarcode] = useState("");
  const [description, setDescription] = useState("");
  const [keepCategory, setKeepCategory] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [categoryNames, setCategoryNames] = useState(categories);
  const [notice, setNotice] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      const result = await createAccessory({
        name,
        category,
        barcode,
        description,
      });

      if (!result.ok) {
        setNotice({ kind: "error", text: result.error ?? "Something went wrong." });
        nameRef.current?.focus();
        return;
      }

      counter.current += 1;
      const savedName = result.product?.name ?? name.trim().replace(/\s+/g, " ");
      setRecent((items) =>
        [
          {
            key: counter.current,
            name: savedName,
            category: result.product?.category_name ?? (category.trim() || null),
            existing: result.existing,
          },
          ...items,
        ].slice(0, 8)
      );
      if (result.createdCategory) {
        const created = result.createdCategory;
        setCategoryNames((names) =>
          [...names, created].sort((a, b) => a.localeCompare(b))
        );
      }
      setNotice({
        kind: "success",
        text: result.message ?? "Saved.",
      });

      // Clear the form for the next item
      setName("");
      setBarcode("");
      setDescription("");
      if (!keepCategory) setCategory("");
      nameRef.current?.focus();
      router.refresh();
    });
  }

  return (
    <section className={cardClass}>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-pill text-pill-ink">
          <Zap className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-bold text-ink">Quick add</h2>
          <p className="text-xs text-ink-muted">
            Type a name and press Enter. The form clears so you can add the next
            item.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1.3fr_1.2fr_auto] md:items-end">
          <div>
            <label htmlFor="quick-name" className={labelClass}>
              Name
            </label>
            <input
              ref={nameRef}
              id="quick-name"
              type="text"
              required
              maxLength={120}
              autoComplete="off"
              autoFocus
              placeholder="e.g. USB-C cable 1m"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="quick-category" className={labelClass}>
              Category (optional)
            </label>
            <input
              id="quick-category"
              type="text"
              list="quick-category-options"
              maxLength={60}
              autoComplete="off"
              placeholder="Pick or type a new one"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className={inputClass}
            />
            <CategoryOptions id="quick-category-options" names={categoryNames} />
          </div>
          <div>
            <label htmlFor="quick-barcode" className={labelClass}>
              Barcode (optional)
            </label>
            <input
              id="quick-barcode"
              type="text"
              maxLength={64}
              autoComplete="off"
              inputMode="text"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              className={inputClass}
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className={primaryButtonClass + " w-full md:w-auto"}
          >
            {pending ? "Saving..." : "Add"}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            aria-controls="quick-more"
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
          >
            <ChevronDown
              className={"h-4 w-4 transition-transform " + (moreOpen ? "rotate-180" : "")}
            />
            More details
          </button>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={keepCategory}
              onChange={(event) => setKeepCategory(event.target.checked)}
              className="h-5 w-5 accent-[var(--accent)]"
            />
            Keep category for the next item
          </label>
        </div>

        {moreOpen && (
          <div id="quick-more">
            <label htmlFor="quick-description" className={labelClass}>
              Description (optional)
            </label>
            <textarea
              id="quick-description"
              rows={3}
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={inputClass}
            />
          </div>
        )}

        {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      </form>

      {recent.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-muted">
            Recently added
          </p>
          <ul className="space-y-1.5">
            {recent.map((item) => (
              <li
                key={item.key}
                className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface-muted px-3 py-2 text-sm"
              >
                {item.existing ? (
                  <Info className="h-4 w-4 shrink-0 text-amber" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {item.name}
                </span>
                {item.category && (
                  <span className="rounded-full bg-aqua px-2 py-0.5 text-xs font-medium text-ink">
                    {item.category}
                  </span>
                )}
                {item.existing && (
                  <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs font-medium text-ink">
                    Already existed
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// Type-ahead search that opens the chosen product in the list below
export function QuickFind({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  return (
    <ProductPicker
      canCreate={canCreate}
      placeholder="Find a product by name..."
      label="Find a product"
      onSelect={(product) => {
        router.push(
          `/catalog/accessories?status=all&q=${encodeURIComponent(product.name)}`
        );
        router.refresh();
      }}
    />
  );
}

export function EditAccessoryForm({
  product,
  categories,
  cancelHref,
}: {
  product: {
    id: string;
    name: string;
    category: string;
    barcode: string;
    description: string;
  };
  categories: string[];
  cancelHref: string;
}) {
  const [state, action, pending] = useActionState(
    updateAccessory,
    initialFormState
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="product_id" value={product.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="edit-name" className={labelClass}>
            Name
          </label>
          <input
            id="edit-name"
            name="name"
            type="text"
            required
            maxLength={120}
            defaultValue={product.name}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="edit-category" className={labelClass}>
            Category (optional)
          </label>
          <input
            id="edit-category"
            name="category"
            type="text"
            list="edit-category-options"
            maxLength={60}
            autoComplete="off"
            defaultValue={product.category}
            className={inputClass}
          />
          <CategoryOptions id="edit-category-options" names={categories} />
        </div>
        <div>
          <label htmlFor="edit-barcode" className={labelClass}>
            Barcode (optional)
          </label>
          <input
            id="edit-barcode"
            name="barcode"
            type="text"
            maxLength={64}
            defaultValue={product.barcode}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="edit-description" className={labelClass}>
            Description (optional)
          </label>
          <textarea
            id="edit-description"
            name="description"
            rows={3}
            maxLength={1000}
            defaultValue={product.description}
            className={inputClass}
          />
        </div>
      </div>

      {state.error && <Notice kind="error">{state.error}</Notice>}
      {state.success && <Notice kind="success">{state.success}</Notice>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving..." : "Save changes"}
        </button>
        <Link href={cancelHref} className={secondaryButtonClass}>
          Close
        </Link>
      </div>
    </form>
  );
}

export function AccessoryActiveToggle({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(
    setAccessoryActive,
    initialFormState
  );
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="product_id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-4 text-xs font-semibold text-ink transition hover:bg-surface-muted disabled:opacity-60"
      >
        {active ? "Deactivate" : "Activate"}
      </button>
      {state.error && (
        <span role="alert" className="text-xs font-medium text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
