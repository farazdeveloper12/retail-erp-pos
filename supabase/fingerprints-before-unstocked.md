# Function fingerprints before the "Item not in stock" migration

Read from **gwadar-test** on 19 Nov 2026 with `supabase/read-sale-functions.sql`,
**before** `migrations/20261119000000_unstocked_sale_lines.sql` was run.
The fingerprint is `md5(pg_get_functiondef(...))`.

| Function | Fingerprint |
| --- | --- |
| `create_quick_sale` | `aa36949d4329f0e2210dd562cf802a69` |
| `create_sale` | `6872bfa99238e6c5ef5b8e650d58b50b` |
| `cancel_sale` | `359f64cfa19a48a941ecc9ec8f1d9778` |
| `sales_return_lines` | `35b1c85e09dd99851e70d01807bc3364` |
| `create_warranty_claim` | `77b545ea9b8aaf252b3d9ea79f792b3b` |

## Before the "profit before VAT" migration

Read from **gwadar-test** on 19 Nov 2026, **before**
`migrations/20261120000000_profit_before_vat.sql` was run. This migration
replaces `get_dashboard`.

| Function | Fingerprint |
| --- | --- |
| `get_dashboard` | `809d7e52cddbeac46a0ccbe2dc7db8e2` |

## How to use

Before the migration is run on the real project, run the read-only
`supabase/read-sale-functions.sql` there and compare its `fingerprint` column
with this table.

- Same fingerprint: the function is identical to the one the migration was
  written from, so the migration is safe for it.
- Different fingerprint: do not run the migration; the migration must first
  be updated to the real project's version of that function.

`create_quick_sale` is not changed by the unstocked migration. After the
migrations, the other four functions and `get_dashboard` have new fingerprints
on gwadar-test, so always compare the real project with these tables, not
with gwadar-test after the migrations.
