"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { UUID_PATTERN } from "@/lib/catalog";

export type FormState = {
  error: string | null;
  success: string | null;
  values?: Record<string, string>;
};

type Db = Awaited<ReturnType<typeof createClient>>;

class ValidationError extends Error {}

// Form mein jo likha tha wo wapas dikhane ke liye
function snapshot(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value === "string") values[name] = value;
  }
  return values;
}

function fail(message: string, formData?: FormData): FormState {
  return {
    error: message,
    success: null,
    values: formData ? snapshot(formData) : undefined,
  };
}

function ok(message: string): FormState {
  revalidatePath("/catalog", "layout");
  return { error: null, success: message };
}

function readText(
  formData: FormData,
  name: string,
  max: number,
  label: string
): string | null {
  const value = String(formData.get(name) ?? "").trim();
  if (value === "") return null;
  if (value.length > max) {
    throw new ValidationError(`${label} ${max} harf se zyada nahi ho sakta.`);
  }
  return value;
}

function requireText(
  formData: FormData,
  name: string,
  max: number,
  label: string
): string {
  const value = readText(formData, name, max, label);
  if (!value) throw new ValidationError(`${label} likhna zaroori hai.`);
  return value;
}

function readInt(
  formData: FormData,
  name: string,
  min: number,
  max: number,
  label: string
): number | null {
  const raw = String(formData.get(name) ?? "").trim();
  if (raw === "") return null;
  if (!/^\d+$/.test(raw)) {
    throw new ValidationError(`${label} sirf number hona chahiye.`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new ValidationError(`${label} ${min} se ${max} ke darmiyan hona chahiye.`);
  }
  return value;
}

function readId(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? "");
  if (!UUID_PATTERN.test(value)) {
    throw new ValidationError("Pehchaan ghalat hai.");
  }
  return value;
}

function dbMessage(
  error: { code?: string; message: string },
  duplicateMessage: string
): string {
  if (error.code === "23505") return duplicateMessage;
  if (error.code === "42501") return "Is kaam ki ijazat nahi hai.";
  return "Database mein masla aaya: " + error.message;
}

// Har action pehle ijazat check karta hai
async function run(
  formData: FormData,
  task: (supabase: Db) => Promise<FormState>
): Promise<FormState> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("has_permission", {
      perm: "catalog.manage",
    });
    if (error || data !== true) {
      return fail("Aap ko catalog badalne ki ijazat nahi hai.", formData);
    }
    return await task(supabase);
  } catch (e) {
    if (e instanceof ValidationError) return fail(e.message, formData);
    throw e;
  }
}

function readModelFields(formData: FormData) {
  const productType = String(formData.get("product_type") ?? "");
  if (productType !== "phone" && productType !== "smartwatch") {
    throw new ValidationError("Type Phone ya Smartwatch chunein.");
  }

  const specSource = readText(formData, "spec_source", 500, "Source link");
  if (specSource && !/^https?:\/\//i.test(specSource)) {
    throw new ValidationError(
      "Source link http:// ya https:// se shuru hona chahiye."
    );
  }

  return {
    name: requireText(formData, "name", 100, "Model ka naam"),
    product_type: productType,
    series: readText(formData, "series", 60, "Series"),
    release_year: readInt(formData, "release_year", 2000, 2100, "Saal"),
    display_info: readText(formData, "display_info", 300, "Display"),
    chipset: readText(formData, "chipset", 150, "Chipset"),
    camera_info: readText(formData, "camera_info", 300, "Camera"),
    battery_info: readText(formData, "battery_info", 150, "Battery"),
    os_info: readText(formData, "os_info", 150, "Operating system"),
    description: readText(formData, "description", 1000, "Description"),
    spec_source: specSource,
  };
}

export async function addBrand(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  return run(formData, async (supabase) => {
    const name = requireText(formData, "name", 60, "Brand ka naam");
    const { error } = await supabase.from("brands").insert({ name });
    if (error) {
      return fail(dbMessage(error, "Ye brand pehle se maujood hai."), formData);
    }
    return ok(`${name} brand add ho gaya.`);
  });
}

export async function createModel(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  return run(formData, async (supabase) => {
    const brandId = readId(formData, "brand_id");
    const fields = readModelFields(formData);

    const { data, error } = await supabase
      .from("product_models")
      .insert({ brand_id: brandId, ...fields })
      .select("id")
      .single();

    if (error || !data) {
      return fail(
        dbMessage(
          error ?? { message: "Model nahi ban saka." },
          "Is brand mein ye model pehle se maujood hai."
        ),
        formData
      );
    }

    revalidatePath("/catalog", "layout");
    redirect(`/catalog/model?id=${data.id}`);
  });
}

export async function updateModel(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  return run(formData, async (supabase) => {
    const modelId = readId(formData, "model_id");
    const fields = readModelFields(formData);

    const { error } = await supabase
      .from("product_models")
      .update(fields)
      .eq("id", modelId);

    if (error) {
      return fail(
        dbMessage(error, "Is brand mein is naam ka model pehle se maujood hai."),
        formData
      );
    }
    return ok("Model ki maloomat save ho gayin.");
  });
}

export async function addVariant(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  return run(formData, async (supabase) => {
    const modelId = readId(formData, "model_id");

    const storage = readInt(formData, "storage", 1, 4096, "Storage");
    if (storage === null) {
      throw new ValidationError("Storage likhna zaroori hai.");
    }
    const unit = String(formData.get("storage_unit") ?? "");
    if (unit !== "GB" && unit !== "TB") {
      throw new ValidationError("Storage ki unit GB ya TB chunein.");
    }
    const storageGb = unit === "TB" ? storage * 1024 : storage;
    if (storageGb > 4096) {
      throw new ValidationError("Storage 4TB se zyada nahi ho sakta.");
    }

    const ramGb = readInt(formData, "ram", 1, 64, "RAM");

    const { error } = await supabase.from("model_variants").insert({
      model_id: modelId,
      storage_gb: storageGb,
      ram_gb: ramGb,
    });
    if (error) {
      return fail(
        dbMessage(error, "Ye storage aur RAM ka variant pehle se maujood hai."),
        formData
      );
    }
    return ok("Variant add ho gaya.");
  });
}

export async function addColor(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  return run(formData, async (supabase) => {
    const modelId = readId(formData, "model_id");
    const name = requireText(formData, "name", 60, "Color ka naam");

    const { error } = await supabase
      .from("model_colors")
      .insert({ model_id: modelId, name });
    if (error) {
      return fail(dbMessage(error, "Ye color pehle se maujood hai."), formData);
    }
    return ok(`${name} color add ho gaya.`);
  });
}

const TABLES = {
  model: "product_models",
  variant: "model_variants",
  color: "model_colors",
} as const;

// Model, variant ya color ko band / chalu karna (delete nahi hota)
export async function setActive(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  return run(formData, async (supabase) => {
    const kind = String(formData.get("kind") ?? "");
    if (kind !== "model" && kind !== "variant" && kind !== "color") {
      throw new ValidationError("Ghalat chunav.");
    }
    const id = readId(formData, "id");
    const active = String(formData.get("active")) === "true";

    const { error } = await supabase
      .from(TABLES[kind])
      .update({ is_active: active })
      .eq("id", id);
    if (error) {
      return fail(dbMessage(error, "Ye nahi ho saka."), formData);
    }
    return ok(active ? "Chalu kar diya gaya." : "Band kar diya gaya.");
  });
}