"use client";

import { useActionState } from "react";
import { REGION_OPTIONS } from "@/lib/region";
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
          <label htmlFor="settings-region" className={labelClass}>
            Region
          </label>
          {/* key: React applies a select's defaultValue only on mount */}
          <select
            key={value("region")}
            id="settings-region"
            name="region"
            required
            defaultValue={value("region") || "PK"}
            aria-describedby="settings-region-help"
            className={inputClass}
          >
            {REGION_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} – {r.currency}
              </option>
            ))}
          </select>
          <p id="settings-region-help" className="mt-1 text-xs text-ink-muted">
            Sets the currency and time zone. Pakistan: PKR, PTA status, CNIC. UAE: AED, VAT, Arabic invoices, Emirates ID.
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
