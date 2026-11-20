import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isPtaStatus } from "@/lib/pta";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PhoneOptionError extends Error {}

type Db = Awaited<ReturnType<typeof createClient>>;

// Checks a phone spec from the browser (model_id, storage_gb, ram_gb,
// color_name) and returns the catalog ids, creating a missing storage/RAM
// option or colour in the database (no duplicates).
export async function resolvePhoneOption(
  supabase: Db,
  raw: unknown,
  label: string
): Promise<{ model_id: string; variant_id: string; color_id: string | null }> {
  if (typeof raw !== "object" || raw === null) throw new PhoneOptionError(`${label}: the phone is not valid.`);
  const input = raw as Record<string, unknown>;
  const modelId = input.model_id;
  if (typeof modelId !== "string" || !UUID.test(modelId)) throw new PhoneOptionError(`${label}: choose the phone model.`);
  const storage = input.storage_gb;
  if (typeof storage !== "number" || !Number.isInteger(storage) || storage < 1 || storage > 4096) {
    throw new PhoneOptionError(`${label}: choose the storage.`);
  }
  const ram = input.ram_gb;
  if (ram !== null && ram !== undefined && (typeof ram !== "number" || !Number.isInteger(ram) || ram < 1 || ram > 64)) {
    throw new PhoneOptionError(`${label}: RAM must be from 1 to 64 GB.`);
  }
  const color = typeof input.color_name === "string" ? input.color_name.trim().replace(/\s+/g, " ") : "";
  if (color.length > 60) throw new PhoneOptionError(`${label}: the colour can have at most 60 characters.`);

  const { data, error } = await supabase.rpc("ensure_phone_option", {
    p_payload: { model_id: modelId, storage_gb: storage, ram_gb: ram ?? null, color_name: color || null },
  });
  if (error) throw new PhoneOptionError(`${label}: ${error.message}`);
  const result = data as { variant_id?: string; color_id?: string | null } | null;
  if (!result?.variant_id) throw new PhoneOptionError(`${label}: the storage option could not be saved.`);
  return { model_id: modelId, variant_id: result.variant_id, color_id: result.color_id ?? null };
}

// PTA value from the browser: one of the three values, or null (unknown)
export function ptaValue(raw: unknown, label: string): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (!isPtaStatus(raw)) throw new PhoneOptionError(`${label}: the PTA status is not valid.`);
  return raw;
}
