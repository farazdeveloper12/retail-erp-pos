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
import SupplierPicker from "@/components/SupplierPicker";
import {
  createSupplier,
  setSupplierActive,
  updateSupplier,
  type SupplierFormState,
} from "@/app/(app)/suppliers/actions";
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
  phone: string | null;
  existing: boolean;
};

const initialFormState: SupplierFormState = { error: null, success: null };

// Fast "Excel-like" entry: type, press Enter, type the next one.
export function QuickAddSupplierForm() {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    startTransition(async () => {
      const result = await createSupplier({ name, phone, address, notes });

      if (!result.ok) {
        setNotice({ kind: "error", text: result.error ?? "Something went wrong." });
        nameRef.current?.focus();
        return;
      }

      counter.current += 1;
      setRecent((items) =>
        [
          {
            key: counter.current,
            name: result.supplier?.name ?? name.trim().replace(/\s+/g, " "),
            phone: result.supplier?.phone ?? (phone.trim() || null),
            existing: result.existing,
          },
          ...items,
        ].slice(0, 8)
      );
      setNotice({ kind: "success", text: result.message ?? "Saved." });

      // Clear the form for the next supplier
      setName("");
      setPhone("");
      setAddress("");
      setNotes("");
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
            supplier.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1.3fr_auto] md:items-end">
          <div>
            <label htmlFor="supplier-quick-name" className={labelClass}>
              Name
            </label>
            <input
              ref={nameRef}
              id="supplier-quick-name"
              type="text"
              required
              maxLength={120}
              autoComplete="off"
              autoFocus
              placeholder="e.g. City Mobile Traders"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="supplier-quick-phone" className={labelClass}>
              Phone (optional)
            </label>
            <input
              id="supplier-quick-phone"
              type="tel"
              maxLength={40}
              autoComplete="off"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
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

        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls="supplier-quick-more"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-strong"
        >
          <ChevronDown
            className={"h-4 w-4 transition-transform " + (moreOpen ? "rotate-180" : "")}
          />
          More details
        </button>

        {moreOpen && (
          <div id="supplier-quick-more" className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="supplier-quick-address" className={labelClass}>
                Address (optional)
              </label>
              <textarea
                id="supplier-quick-address"
                rows={3}
                maxLength={300}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="supplier-quick-notes" className={labelClass}>
                Notes (optional)
              </label>
              <textarea
                id="supplier-quick-notes"
                rows={3}
                maxLength={1000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className={inputClass}
              />
            </div>
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
                {item.phone && (
                  <span className="text-xs text-ink-muted">{item.phone}</span>
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

// Type-ahead search that opens the chosen supplier in the list below
export function QuickFindSupplier({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  return (
    <SupplierPicker
      canCreate={canCreate}
      placeholder="Find a supplier by name..."
      label="Find a supplier"
      onSelect={(supplier) => {
        router.push(`/suppliers?status=all&q=${encodeURIComponent(supplier.name)}`);
        router.refresh();
      }}
    />
  );
}

export function EditSupplierForm({
  supplier,
  cancelHref,
}: {
  supplier: {
    id: string;
    name: string;
    phone: string;
    address: string;
    notes: string;
  };
  cancelHref: string;
}) {
  const [state, action, pending] = useActionState(
    updateSupplier,
    initialFormState
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="supplier_id" value={supplier.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="supplier-edit-name" className={labelClass}>
            Name
          </label>
          <input
            id="supplier-edit-name"
            name="name"
            type="text"
            required
            maxLength={120}
            defaultValue={supplier.name}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="supplier-edit-phone" className={labelClass}>
            Phone (optional)
          </label>
          <input
            id="supplier-edit-phone"
            name="phone"
            type="tel"
            maxLength={40}
            defaultValue={supplier.phone}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="supplier-edit-address" className={labelClass}>
            Address (optional)
          </label>
          <textarea
            id="supplier-edit-address"
            name="address"
            rows={3}
            maxLength={300}
            defaultValue={supplier.address}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="supplier-edit-notes" className={labelClass}>
            Notes (optional)
          </label>
          <textarea
            id="supplier-edit-notes"
            name="notes"
            rows={3}
            maxLength={1000}
            defaultValue={supplier.notes}
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

export function SupplierActiveToggle({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const [state, action, pending] = useActionState(
    setSupplierActive,
    initialFormState
  );
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="supplier_id" value={id} />
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
