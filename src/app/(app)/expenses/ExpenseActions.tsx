"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputClass, labelClass } from "@/components/ui";
import { DeleteEntryButton, EditButton, ReasonPanel } from "@/components/entries/EntryDialog";
import { editExpense } from "@/lib/entry-actions";
import { cleanMoneyInput, isValidMoneyInput } from "@/lib/money";

// Edit (amount, date, category, description) and delete one expense
export default function ExpenseActions({
  expense,
  currency,
  canEdit,
  canDelete,
}: {
  expense: { id: string; amount: string; expense_date: string; category: string; description: string };
  currency: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(expense.amount);
  const [date, setDate] = useState(expense.expense_date);
  const [category, setCategory] = useState(expense.category);
  const [description, setDescription] = useState(expense.description);

  if (open) {
    return (
      <div className="basis-full">
        <ReasonPanel
          title="Edit expense"
          confirmLabel="Save changes"
          onClose={() => setOpen(false)}
          onConfirm={async (reason) => {
            if (!isValidMoneyInput(amount)) return { ok: false, error: "Enter a valid amount." };
            const result = await editExpense({
              expense_id: expense.id,
              reason,
              amount: Number(cleanMoneyInput(amount)),
              expense_date: date,
              category,
              description,
            });
            if (result.ok) router.refresh();
            return result;
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={labelClass + " mb-0"}>
              Amount ({currency})
              <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass + " mt-1"} />
            </label>
            <label className={labelClass + " mb-0"}>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass + " mt-1"} />
            </label>
            <label className={labelClass + " mb-0"}>
              Category
              <input type="text" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass + " mt-1"} />
            </label>
            <label className={labelClass + " mb-0"}>
              Description
              <input type="text" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass + " mt-1"} />
            </label>
          </div>
        </ReasonPanel>
      </div>
    );
  }

  return (
    <span className="flex flex-wrap justify-end gap-1">
      {canEdit && <EditButton compact label="expense" onClick={() => setOpen(true)} />}
      {canDelete && (
        <DeleteEntryButton
          compact
          type="expense"
          id={expense.id}
          label="expense"
          explanation="The expense is removed from lists and totals and the money comes back to Cash/Bank."
        />
      )}
    </span>
  );
}
