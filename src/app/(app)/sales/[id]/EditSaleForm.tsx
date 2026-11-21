"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass } from "@/components/ui";
import { EditButton, ReasonPanel } from "@/components/entries/EntryDialog";
import { editSale } from "@/lib/entry-actions";
import { cleanMoneyInput, isValidMoneyInput } from "@/lib/money";

export type EditableLine = {
  id: string;
  item_type: string;
  description: string;
  quantity: number;
  unit_price: string;
  discount: string;
  // Only for "Item not in stock" lines and users who may see cost
  unit_cost: string | null;
};

const num = (v: string) => Number(cleanMoneyInput(v.trim() || "0"));

// Edit prices, discounts, the invoice discount, notes and the cost of
// "Item not in stock" lines. Totals, profit and balances are recalculated
// by the database.
export default function EditSaleForm({
  saleId,
  lines,
  discount,
  notes,
  currency,
}: {
  saleId: string;
  lines: EditableLine[];
  discount: string;
  notes: string;
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(lines);
  const [invoiceDiscount, setInvoiceDiscount] = useState(discount);
  const [note, setNote] = useState(notes);

  if (!open) return <EditButton label="invoice" onClick={() => setOpen(true)} />;

  const invalid =
    rows.some(
      (r) =>
        !isValidMoneyInput(r.unit_price) ||
        (r.discount.trim() !== "" && !isValidMoneyInput(r.discount)) ||
        (r.unit_cost !== null && !isValidMoneyInput(r.unit_cost))
    ) ||
    (invoiceDiscount.trim() !== "" && !isValidMoneyInput(invoiceDiscount));

  return (
    <div className="basis-full">
      <ReasonPanel
        title="Edit invoice"
        confirmLabel="Save changes"
        onClose={() => {
          setOpen(false);
          setRows(lines);
        }}
        onConfirm={async (reason) => {
          if (invalid) return { ok: false, error: "Enter valid amounts (up to 2 decimals)." };
          const result = await editSale({
            sale_id: saleId,
            reason,
            discount: num(invoiceDiscount),
            notes: note,
            items: rows.map((r) => ({
              sale_item_id: r.id,
              unit_price: num(r.unit_price),
              discount: num(r.discount),
              ...(r.unit_cost !== null ? { unit_cost: num(r.unit_cost) } : {}),
            })),
          });
          if (result.ok) router.refresh();
          return result;
        }}
      >
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={row.id} className="grid gap-2 rounded-2xl border border-line p-3 sm:grid-cols-4 sm:items-end">
              <p className="text-sm font-semibold text-ink sm:col-span-4">
                {row.description} <span className="font-normal text-ink-muted">× {row.quantity}</span>
              </p>
              <label className={labelClass + " mb-0"}>
                Unit price ({currency})
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.unit_price}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, unit_price: e.target.value } : r)))}
                  className={inputClass + " mt-1"}
                />
              </label>
              <label className={labelClass + " mb-0"}>
                Discount ({currency})
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={row.discount}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, discount: e.target.value } : r)))}
                  className={inputClass + " mt-1"}
                />
              </label>
              {row.unit_cost !== null && (
                <label className={labelClass + " mb-0"}>
                  Cost price ({currency})
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.unit_cost}
                    onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, unit_cost: e.target.value } : r)))}
                    className={inputClass + " mt-1"}
                  />
                </label>
              )}
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={labelClass + " mb-0"}>
              Invoice discount ({currency})
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={invoiceDiscount}
                onChange={(e) => setInvoiceDiscount(e.target.value)}
                className={inputClass + " mt-1"}
              />
            </label>
            <label className={labelClass + " mb-0"}>
              Notes
              <input
                type="text"
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={inputClass + " mt-1"}
              />
            </label>
          </div>
          <p className="text-xs text-ink-muted">
            The total, profit and the customer balance are recalculated. If the cost of an item bought from a supplier
            changes, the supplier balance changes too.
          </p>
        </div>
      </ReasonPanel>
    </div>
  );
}
