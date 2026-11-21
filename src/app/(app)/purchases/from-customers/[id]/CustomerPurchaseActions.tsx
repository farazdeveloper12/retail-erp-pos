"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass } from "@/components/ui";
import { DeleteEntryButton, EditButton, ReasonPanel } from "@/components/entries/EntryDialog";
import { editCustomerPurchase } from "@/lib/entry-actions";
import { cleanMoneyInput, isValidMoneyInput } from "@/lib/money";
import { GRADE_OPTIONS } from "@/lib/trade-in";

export type EditableCustomerPurchase = {
  id: string;
  price: string;
  grade: string;
  condition_notes: string;
  seller_name: string;
  seller_phone: string;
  seller_id_number: string;
  trade_in: boolean;
};

// Edit price, grade, notes and seller details; delete (phone leaves stock,
// money comes back or the trade-in credit is removed from the sale)
export default function CustomerPurchaseActions({
  entry,
  currency,
  idLabel,
  canEdit,
  canDelete,
}: {
  entry: EditableCustomerPurchase;
  currency: string;
  // "CNIC" (Pakistan) or "Emirates ID" (UAE)
  idLabel: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(entry);
  const set = (patch: Partial<EditableCustomerPurchase>) => setForm((f) => ({ ...f, ...patch }));

  if (open) {
    return (
      <div className="basis-full">
        <ReasonPanel
          title="Edit phone bought from customer"
          confirmLabel="Save changes"
          onClose={() => setOpen(false)}
          onConfirm={async (reason) => {
            if (!isValidMoneyInput(form.price)) return { ok: false, error: "Enter a valid price." };
            const result = await editCustomerPurchase({
              id: entry.id,
              reason,
              price: Number(cleanMoneyInput(form.price)),
              grade: form.grade,
              condition_notes: form.condition_notes,
              seller_name: form.seller_name,
              seller_phone: form.seller_phone,
              seller_id_number: form.seller_id_number,
            });
            if (result.ok) router.refresh();
            return result;
          }}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <label className={labelClass + " mb-0"}>
              {entry.trade_in ? "Trade-in value" : "Price paid"} ({currency})
              <input type="text" inputMode="decimal" value={form.price} onChange={(e) => set({ price: e.target.value })} className={inputClass + " mt-1"} />
            </label>
            <label className={labelClass + " mb-0"}>
              Grade
              <select value={form.grade} onChange={(e) => set({ grade: e.target.value })} className={inputClass + " mt-1"}>
                {GRADE_OPTIONS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass + " mb-0"}>
              Condition notes
              <input type="text" maxLength={500} value={form.condition_notes} onChange={(e) => set({ condition_notes: e.target.value })} className={inputClass + " mt-1"} />
            </label>
            <label className={labelClass + " mb-0"}>
              Seller name
              <input type="text" maxLength={120} value={form.seller_name} onChange={(e) => set({ seller_name: e.target.value })} className={inputClass + " mt-1"} />
            </label>
            <label className={labelClass + " mb-0"}>
              Seller phone
              <input type="tel" maxLength={40} value={form.seller_phone} onChange={(e) => set({ seller_phone: e.target.value })} className={inputClass + " mt-1"} />
            </label>
            <label className={labelClass + " mb-0"}>
              {idLabel}
              <input type="text" maxLength={40} value={form.seller_id_number} onChange={(e) => set({ seller_id_number: e.target.value })} className={inputClass + " mt-1"} />
            </label>
          </div>
          <p className="text-xs text-ink-muted">
            A new price changes the phone&apos;s cost (and the profit if it is already sold) and the Cash/Bank payment,
            or for a trade-in the credit on the sale.
          </p>
        </ReasonPanel>
      </div>
    );
  }

  return (
    <span className="flex flex-wrap gap-2 print:hidden">
      {canEdit && <EditButton label="entry" onClick={() => setOpen(true)} />}
      {canDelete && (
        <DeleteEntryButton
          type="customer_purchase"
          id={entry.id}
          label="this phone purchase"
          explanation={
            entry.trade_in
              ? "The phone leaves stock and its trade-in credit is removed from the sale, so the customer owes that amount again. Not possible when the phone is already sold."
              : "The phone leaves stock and the money paid comes back to Cash/Bank. Not possible when the phone is already sold."
          }
          afterHref="/purchases/from-customers"
        />
      )}
    </span>
  );
}
