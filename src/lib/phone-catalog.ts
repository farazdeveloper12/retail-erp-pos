// Phone catalog helpers shared by every screen where a phone is chosen:
// search with partial words in any order, storage/RAM/colour choices and
// the payload the server turns into catalog ids (missing options are created).

import type { CatalogBrand, CatalogModel } from "@/app/(app)/purchases/new/actions";

// What the forms keep for a phone: the model and its options as text
export type PhoneSpec = {
  modelId: string;
  storage: string; // GB as text, for example "256"; "" = not chosen
  ram: string; // GB as text; "" = not given (always "" for Apple)
  color: string; // free text; "" = not given
};

export const EMPTY_SPEC: PhoneSpec = { modelId: "", storage: "", ram: "", color: "" };

// Offered for every model, in addition to the model's own colours
export const COMMON_COLORS = [
  "Black",
  "White",
  "Silver",
  "Gray",
  "Blue",
  "Green",
  "Gold",
  "Purple",
  "Pink",
  "Red",
  "Orange",
  "Yellow",
];

export function storageLabel(gb: number): string {
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024}TB` : `${gb}GB`;
}

// "512", "512gb", "1tb", "1 TB" -> GB; null when not valid
export function parseStorage(text: string): number | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, "");
  const tb = /^(\d{1,2})tb$/.exec(value);
  if (tb) return Number(tb[1]) * 1024;
  const gb = /^(\d{1,4})(gb)?$/.exec(value);
  if (!gb) return null;
  const n = Number(gb[1]);
  return n >= 1 && n <= 4096 ? n : null;
}

export function isApple(brandName: string | null | undefined): boolean {
  return (brandName ?? "").trim().toLowerCase() === "apple";
}

// ---------- Catalog index and search ----------

export type CatalogEntry = { model: CatalogModel; brand: string; label: string };

export type SearchOption = {
  key: string;
  modelId: string;
  storage: number | null;
  ram: number | null;
  label: string;
  words: string[];
  year: number;
};

export type PhoneIndex = {
  models: Map<string, CatalogEntry>;
  options: SearchOption[];
  brandNames: string[];
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
}

function wordsOf(text: string): string[] {
  const words = normalize(text).split(" ").filter(Boolean);
  const out = new Set(words);
  // "Galaxy S24 Ultra" also as "s24ultra"; "iPhone 15" also as "iphone15"
  for (let i = 0; i < words.length - 1; i++) out.add(words[i] + words[i + 1]);
  return [...out];
}

export function buildPhoneIndex(brands: CatalogBrand[] | null): PhoneIndex {
  const models = new Map<string, CatalogEntry>();
  const options: SearchOption[] = [];
  const brandNames: string[] = [];
  for (const brand of brands ?? []) {
    brandNames.push(brand.name);
    for (const model of brand.models) {
      const label = `${brand.name} ${model.name}`;
      models.set(model.id, { model, brand: brand.name, label });
      const baseWords = wordsOf(label);
      const year = model.year ?? 0;
      options.push({ key: model.id, modelId: model.id, storage: null, ram: null, label, words: baseWords, year });
      const apple = isApple(brand.name);
      const seenStorage = new Set<string>();
      for (const variant of model.variants) {
        const ram = apple ? null : variant.ram_gb;
        const id = `${variant.storage_gb}/${ram ?? 0}`;
        if (seenStorage.has(id)) continue;
        seenStorage.add(id);
        const storage = storageLabel(variant.storage_gb);
        const extra = [storage, String(variant.storage_gb)];
        if (variant.storage_gb >= 1024) extra.push(`${variant.storage_gb / 1024}tb`);
        if (ram) extra.push(`${ram}gb`, `${ram}/${variant.storage_gb}`);
        options.push({
          key: `${model.id}:${id}`,
          modelId: model.id,
          storage: variant.storage_gb,
          ram,
          label: ram ? `${label} ${ram}GB/${storage}` : `${label} ${storage}`,
          words: [...baseWords, ...extra.map((w) => w.toLowerCase())],
          year,
        });
      }
    }
  }
  return { models, options, brandNames: brandNames.sort((a, b) => a.localeCompare(b)) };
}

// Every typed piece must be the start of some word, in any order:
// "iph 15 pro 256" -> "Apple iPhone 15 Pro 256GB"
export function searchPhones(index: PhoneIndex, query: string, limit = 8): SearchOption[] {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  const results: { option: SearchOption; score: number }[] = [];
  for (const option of index.options) {
    let score = 0;
    let ok = true;
    for (const token of tokens) {
      let best = 0;
      for (const word of option.words) {
        if (word === token) {
          best = 3;
          break;
        }
        if (word.startsWith(token)) best = Math.max(best, 2);
      }
      if (best === 0) {
        ok = false;
        break;
      }
      score += best;
    }
    if (!ok) continue;
    // Prefer the plain model when no storage was typed, and newer models
    if (option.storage === null) score += 1;
    results.push({ option, score });
  }
  results.sort(
    (a, b) =>
      b.score - a.score ||
      b.option.year - a.option.year ||
      a.option.label.length - b.option.label.length ||
      a.option.label.localeCompare(b.option.label)
  );
  return results.slice(0, limit).map((r) => r.option);
}

// ---------- Options of one model ----------

export function storageOptions(model: CatalogModel | undefined): number[] {
  return [...new Set((model?.variants ?? []).map((v) => v.storage_gb))].sort((a, b) => a - b);
}

export function ramOptions(model: CatalogModel | undefined, storage: number | null): number[] {
  const variants = (model?.variants ?? []).filter((v) => storage === null || v.storage_gb === storage);
  const list = variants.map((v) => v.ram_gb).filter((r): r is number => r !== null);
  return [...new Set(list.length > 0 ? list : (model?.variants ?? []).map((v) => v.ram_gb).filter((r): r is number => r !== null))].sort(
    (a, b) => a - b
  );
}

export function colorOptions(model: CatalogModel | undefined): string[] {
  const own = (model?.colors ?? []).map((c) => c.name);
  const lower = new Set(own.map((c) => c.toLowerCase()));
  return [...own, ...COMMON_COLORS.filter((c) => !lower.has(c.toLowerCase()))];
}

// Problems in a spec, for the forms ("" when fine)
export function specProblem(spec: PhoneSpec): string {
  if (!spec.modelId) return "Choose the phone model.";
  if (parseStorage(spec.storage) === null) return "Choose the storage.";
  if (spec.ram.trim()) {
    const ram = Number(spec.ram);
    if (!Number.isInteger(ram) || ram < 1 || ram > 64) return "RAM must be from 1 to 64 GB.";
  }
  if (spec.color.trim().length > 60) return "The colour can have at most 60 characters.";
  return "";
}

// What the server needs to find or create the catalog option
export function specPayload(spec: PhoneSpec): Record<string, unknown> {
  return {
    model_id: spec.modelId,
    storage_gb: parseStorage(spec.storage),
    ram_gb: spec.ram.trim() ? Number(spec.ram) : null,
    color_name: spec.color.trim() || null,
  };
}

// "Apple iPhone 15 Pro 256GB Blue" for lists and summaries
export function specLabel(index: PhoneIndex, spec: PhoneSpec): string {
  const entry = index.models.get(spec.modelId);
  if (!entry) return "Phone";
  const storage = parseStorage(spec.storage);
  const parts = [entry.label];
  if (storage) parts.push(spec.ram.trim() ? `${spec.ram}GB/${storageLabel(storage)}` : storageLabel(storage));
  if (spec.color.trim()) parts.push(spec.color.trim());
  return parts.join(" ");
}
