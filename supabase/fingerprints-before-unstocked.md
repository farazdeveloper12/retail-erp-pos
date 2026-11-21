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

## Before Part 2 (phone catalog and PTA status)

Read from **gwadar-test** on 20 Nov 2026, **before**
`migrations/20261122000000_phone_catalog_pta.sql` was run (and after the
unstocked, profit before VAT and trade-in migrations). That migration
replaces these four functions.

| Function | Arguments | Fingerprint |
| --- | --- | --- |
| `create_purchase` | `p_payload jsonb` | `38985d7d80ac6ea6bb1f3a5fbf212854` |
| `create_quick_sale` | `p_payload jsonb` | `aa36949d4329f0e2210dd562cf802a69` |
| `create_sale` | `p_payload jsonb` | `51cb81ed1e36dd665e74380fa140c102` |
| `customer_purchase_add_unit` | `p_biz uuid, p_uid uuid, p_phone jsonb, OUT unit_id uuid, OUT description text` | `c077bc44d082ee75e92ae52917ce8227` |

On the real project, compare these only after the earlier migrations have
been run there too: `create_sale` is changed by the unstocked migration and
`customer_purchase_add_unit` is created by the trade-in migration.
`create_quick_sale` was not changed by any earlier migration, so its
fingerprint is the same as in the first table.

## Before Part 3 ("Item not in stock" with supplier)

Read from **gwadar-test** on 21 Nov 2026, **before**
`migrations/20261123000000_unstocked_supplier.sql` was run (after the Part 2
migration). That migration replaces only `create_sale`.

| Function | Arguments | Fingerprint |
| --- | --- | --- |
| `create_sale` | `p_payload jsonb` | `e2e1c4aaaa8017fed3c3182761090a49` |

On the real project this matches only after the Part 2 migration has been
run there too.
