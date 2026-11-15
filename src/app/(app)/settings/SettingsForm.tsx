"use client";

import { useActionState } from "react";
import {
  updateBusinessSettings,
  type SettingsState,
} from "@/app/(app)/settings/actions";
import {
  Notice,
  inputClass,
  labelClass,
  primaryButtonClass,
} from "@/components/ui";

const initialState: SettingsState = { error: null, success: null };

export default function SettingsForm({
  defaults,
}: {
  defaults: Record<string, string>;
}) {
  const [state, action, pending] = useActionState(
    updateBusinessSettings,
    initialState
  );

  const value = (name: string) => state.values?.[name] ?? defaults[name] ?? "";

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="settings-name" className={labelClass}>
            Business name
          </label>
          <input
            id="settings-name"
            name="name"
            type="text"
            required
            maxLength={120}
            defaultValue={value("name")}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="settings-legal_name" className={labelClass}>
            Legal name (optional)
          </label>
          <input
            id="settings-legal_name"
            name="legal_name"
            type="text"
            maxLength={160}
            defaultValue={value("legal_name")}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="settings-currency_code" className={labelClass}>
            Currency code
          </label>
          <input
            id="settings-currency_code"
            name="currency_code"
            type="text"
            required
            minLength={3}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            autoCapitalize="characters"
            placeholder="PKR"
            defaultValue={value("currency_code") || "PKR"}
            aria-describedby="currency-hint"
            className={inputClass + " uppercase"}
          />
          <p id="currency-hint" className="mt-1 text-xs text-ink-muted">
            Three letters, for example PKR.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="settings-tax_label" className={labelClass}>
              Tax label
            </label>
            <input
              id="settings-tax_label"
              name="tax_label"
              type="text"
              maxLength={30}
              placeholder="GST"
              defaultValue={value("tax_label")}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="settings-tax_rate" className={labelClass}>
              Tax rate (%)
            </label>
            <input
              id="settings-tax_rate"
              name="tax_rate"
              type="text"
              inputMode="decimal"
              placeholder="0"
              defaultValue={value("tax_rate")}
              aria-describedby="tax-hint"
              className={inputClass}
            />
          </div>
          <p id="tax-hint" className="col-span-2 -mt-1 text-xs text-ink-muted">
            From 0 to 100, up to 2 decimals.
          </p>
        </div>

        <div>
          <label htmlFor="settings-phone" className={labelClass}>
            Phone (optional)
          </label>
          <input
            id="settings-phone"
            name="phone"
            type="tel"
            maxLength={40}
            autoComplete="tel"
            defaultValue={value("phone")}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="settings-email" className={labelClass}>
            Email (optional)
          </label>
          <input
            id="settings-email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={value("email")}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="settings-address" className={labelClass}>
            Address (optional)
          </label>
          <textarea
            id="settings-address"
            name="address"
            rows={3}
            maxLength={300}
            defaultValue={value("address")}
            className={inputClass}
          />
        </div>
      </div>

      {state.error && <Notice kind="error">{state.error}</Notice>}
      {state.success && <Notice kind="success">{state.success}</Notice>}

      <button
        type="submit"
        disabled={pending}
        className={primaryButtonClass + " w-full sm:w-auto"}
      >
        {pending ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}
