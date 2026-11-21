"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass } from "@/components/ui";
import { EditButton, ReasonPanel } from "@/components/entries/EntryDialog";
import { editPurchase } from "@/lib/entry-actions";
import { cleanMoneyInput, isValidMoneyInput } from "@/lib/money";

export type EditablePurchaseLine = { id: string; description: string; quantity: number; unit_cost: string };

// Edit line costs (supplier changed the price), date, supplier invoice no and
// notes. Stock costs, profit of phones already sold and the supplier balance
// are recalculated by the database.
export default function EditPurchaseForm({
  purchaseId,
  lines,
  purchaseDate,
  invoiceNo,
  notes,
  currency,
}: {
  purchaseId: string;
  lines: EditablePurchaseLine[];
  purchaseDate: string;
  invoiceNo: string;
  notes: string;
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(lines);
  const [date, setDate] = useState(purchaseDate);
  const [ref, setRef] = useState(invoiceNo);
  const [note, setNote] = useState(notes);

  if (!open) return <EditButton label="purchase" onClick={() => setOpen(true)} />;

  return (
    <div className="basis-full">
      <ReasonPanel
        title="Edit purchase"
        confirmLabel="Save changes"
        onClose={() => {
          setOpen(false);
          setRows(lines);
        }}
        onConfirm={async (reason) => {
          if (rows.some((r) => !isValidMoneyInput(r.unit_cost))) {
            return { ok: false, error: "Enter valid purchase prices (up to 2 decimals)." };
          }
          const result = await editPurchase({
            purchase_id: purchaseId,
            reason,
            purchase_date: date,
            supplier_invoice_no: ref,
            notes: note,
            items: rows.map((r) => ({ purchase_item_id: r.id, unit_cost: Number(cleanMoneyInput(r.unit_cost)) })),
          });
          if (result.ok) router.refresh();
          return result;
        }}
      >
        <div className="space-y-3">
          {rows.map((row, i) => (
            <label key={row.id} className={labelClass + " mb-0 block"}>
              {row.description} × {row.quantity}: purchase price per unit ({currency})
              <input
                type="text"
                inputMode="decimal"
                value={row.unit_cost}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, unit_cost: e.target.value } : r)))}
                className={inputClass + " mt-1"}
              />
            </label>
          ))}
          <div className="grid gap-2 sm:grid-cols-3">
            <label className={labelClass + " mb-0"}>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass + " mt-1"} />
            </label>
            <label className={labelClass + " mb-0"}>
              Supplier invoice no
              <input type="text" maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} className={inputClass + " mt-1"} />
            </label>
            <label className={labelClass + " mb-0"}>
              Notes
              <input type="text" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass + " mt-1"} />
            </label>
          </div>
          <p className="text-xs text-ink-muted">
            The stock cost, the profit of phones already sold and the supplier balance are recalculated.
          </p>
        </div>
      </ReasonPanel>
    </div>
  );
}
