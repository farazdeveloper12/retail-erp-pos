# Phone catalog data

One text file per brand (or brand group). These files are the source of the
shared phone catalog (brands, models, storage/RAM options and colours).

## Format

```
# Brand name
Model name | release year | variants | colours
```

- **Variants**
  - Apple: storage only, in GB, comma separated: `128, 256, 512, 1TB`
  - Other brands: `RAM/storage` in GB, comma separated: `8/128, 8/256, 12/256`
  - `1TB` and `2TB` are allowed for storage.
- **Colours**: comma separated, official names where known. May be empty; the
  app always also offers common colours and free text.
- Lines starting with `#` set the brand; empty lines and lines starting with
  `//` are ignored.

## Updating the catalog

1. Edit or add lines in the `.txt` files.
2. Build the SQL seed:
   ```
   node scripts/build-phone-catalog.mjs
   ```
3. Run `supabase/seeds/phone-catalog.sql` in the Supabase SQL Editor.

The seed only adds what is missing (brand, model, variant, colour; names are
compared without case). It never changes or removes existing catalog rows,
so it is safe to run again.

## How reliable is this data

- Apple, Samsung, Google Pixel and OnePlus: model names and storage options
  are reliable; colours are the official launch colours.
- Xiaomi/Redmi/Poco, Oppo, Vivo, Realme, Honor, Huawei, Motorola, Nokia:
  model names are reliable; some RAM/storage combinations and colours may be
  incomplete or differ by country.
- Infinix, Tecno, itel and especially Sparx: lower confidence, mainly for
  RAM/storage combinations and colour names. Check against the boxes in the
  shop and correct the files when something is wrong.
- Missing storage, RAM or colour options can always be entered with "Other"
  in the app; they are then added to the catalog automatically.
