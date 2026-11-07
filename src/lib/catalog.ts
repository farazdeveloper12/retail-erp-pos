export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  phone: "Phone",
  smartwatch: "Smartwatch",
};

// Show 1024 GB as "1TB"
export function formatStorage(gb: number): string {
  if (gb >= 1024 && gb % 1024 === 0) return `${gb / 1024}TB`;
  return `${gb}GB`;
}

export function formatVariant(storageGb: number, ramGb: number | null): string {
  return ramGb
    ? `${formatStorage(storageGb)} / ${ramGb}GB RAM`
    : formatStorage(storageGb);
}