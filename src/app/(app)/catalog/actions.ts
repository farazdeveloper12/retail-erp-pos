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

// Keeps what the user typed so the form can show it again
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
    throw new ValidationError(`${label} cannot be longer than ${max} characters.`);
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
  if (!value) throw new ValidationError(`${label} is required.`);
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
    throw new ValidationError(`${label} must be a whole number.`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new ValidationError(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function readId(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? "");
  if (!UUID_PATTERN.test(value)) {
    throw new ValidationError("Invalid ID.");
  }
  return value;
}

function dbMessage(
  error: { code?: string; message: string },
  duplicateMessage: string
): string {
  if (error.code === "23505") return duplicateMessage;
  if (error.code === "42501") return "You do not have permission to do this.";
  return "A database error occurred: " + error.message;
}

// Every action checks permission first
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
      return fail("You do not have permission to change the catalog.", formData);
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
    throw new ValidationError("Please choose Phone or Smartwatch as the type.");
  }

  const specSource = readText(formData, "spec_source", 500, "Source link");
  if (specSource && !/^https?:\/\//i.test(specSource)) {
    throw new ValidationError(
      "Source link must start with http:// or https://."
    );
  }

  return {
    name: requireText(formData, "name", 100, "Model name"),
    product_type: productType,
    series: readText(formData, "series", 60, "Series"),
    release_year: readInt(formData, "release_year", 2000, 2100, "Release year"),
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
    const name = requireText(formData, "name", 60, "Brand name");
    const { error } = await supabase.from("brands").insert({ name });
    if (error) {
      return fail(dbMessage(error, "This brand already exists."), formData);
    }
    return ok(`Brand "${name}" has been added.`);
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
          error ?? { message: "The model could not be created." },
          "This model already exists for this brand."
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
        dbMessage(error, "A model with this name already exists for this brand."),
        formData
      );
    }
    return ok("Model details saved.");
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
      throw new ValidationError("Storage is required.");
    }
    const unit = String(formData.get("storage_unit") ?? "");
    if (unit !== "GB" && unit !== "TB") {
      throw new ValidationError("Please choose GB or TB as the storage unit.");
    }
    const storageGb = unit === "TB" ? storage * 1024 : storage;
    if (storageGb > 4096) {
      throw new ValidationError("Storage cannot be more than 4TB.");
    }

    const ramGb = readInt(formData, "ram", 1, 64, "RAM");

    const { error } = await supabase.from("model_variants").insert({
      model_id: modelId,
      storage_gb: storageGb,
      ram_gb: ramGb,
    });
    if (error) {
      return fail(
        dbMessage(error, "A variant with this storage and RAM already exists."),
        formData
      );
    }
    return ok("Variant added.");
  });
}

export async function addColor(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  return run(formData, async (supabase) => {
    const modelId = readId(formData, "model_id");
    const name = requireText(formData, "name", 60, "Color name");

    const { error } = await supabase
      .from("model_colors")
      .insert({ model_id: modelId, name });
    if (error) {
      return fail(dbMessage(error, "This color already exists."), formData);
    }
    return ok(`Color "${name}" has been added.`);
  });
}

const TABLES = {
  model: "product_models",
  variant: "model_variants",
  color: "model_colors",
} as const;

// Activate or deactivate a model, variant or color (nothing is deleted)
export async function setActive(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  return run(formData, async (supabase) => {
    const kind = String(formData.get("kind") ?? "");
    if (kind !== "model" && kind !== "variant" && kind !== "color") {
      throw new ValidationError("Invalid option.");
    }
    const id = readId(formData, "id");
    const active = String(formData.get("active")) === "true";

    const { error } = await supabase
      .from(TABLES[kind])
      .update({ is_active: active })
      .eq("id", id);
    if (error) {
      return fail(dbMessage(error, "This change could not be saved."), formData);
    }
    return ok(active ? "Activated." : "Deactivated.");
  });
}