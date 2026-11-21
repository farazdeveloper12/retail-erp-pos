"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass } from "@/components/ui";
import { DeleteEntryButton, EditButton, ReasonPanel } from "@/components/entries/EntryDialog";
import { editPayment } from "@/lib/entry-actions";
import { cleanMoneyInput, isValidMoneyInput } from "@/lib/money";

// Edit (amount, Cash/Bank, date) and delete one customer or supplier payment
export default function PaymentActions({
  kind,
  paymentId,
  amount,
  method,
  currency,
  canEdit,
  canDelete,
}: {
  kind: "customer" | "supplier";
  paymentId: string;
  amount: string;
  method: string;
  currency: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(amount);
  const [pay, setPay] = useState(method === "bank" ? "bank" : "cash");
  const [date, setDate] = useState("");

  if (open) {
    return (
      <div className="basis-full">
        <ReasonPanel
          title="Edit payment"
          confirmLabel="Save changes"
          onClose={() => setOpen(false)}
          onConfirm={async (reason) => {
            if (!isValidMoneyInput(value)) return { ok: false, error: "Enter a valid amount." };
            const result = await editPayment({
              kind,
              payment_id: paymentId,
              reason,
              amount: Number(cleanMoneyInput(value)),
              payment_method: pay,
              entry_date: date || null,
            });
            if (result.ok) router.refresh();
            return result;
          }}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <label className={labelClass + " mb-0"}>
              Amount ({currency})
              <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={inputClass + " mt-1"}
              />
            </label>
            <label className={labelClass + " mb-0"}>
              Cash or Bank
              <select value={pay} onChange={(e) => setPay(e.target.value)} className={inputClass + " mt-1"}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </select>
            </label>
            <label className={labelClass + " mb-0"}>
              Date (optional)
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass + " mt-1"} />
            </label>
          </div>
        </ReasonPanel>
      </div>
    );
  }

  return (
    <span className="flex gap-1 print:hidden">
      {canEdit && <EditButton compact label="payment" onClick={() => setOpen(true)} />}
      {canDelete && (
        <DeleteEntryButton
          compact
          type={kind === "customer" ? "customer_payment" : "supplier_payment"}
          id={paymentId}
          label="payment"
          explanation="The payment is reversed in Cash/Bank and the balance owed goes up again."
        />
      )}
    </span>
  );
}
