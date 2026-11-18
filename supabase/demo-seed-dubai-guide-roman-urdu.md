# Dubai demo seed – chalane ka tareeqa (sirf gwadar-test)

`demo-seed-dubai.sql` gwadar-test ka saara test data mita kar "Al Noor Mobiles" (Deira, Dubai) ka demo bana deta hai: pichhle 30 din (kal tak), AED, VAT 5%, English + Arabic invoice.

**Kabhi bhi asli project par NA chalayen.** Script khud bhi ruk jati hai agar:

- database mein ek se zyada business hon,
- business ka naam "Test Mobile Shop" ya "Al Noor Mobiles" na ho,
- `owner@test.local` na mile, ya
- koi login aisa ho jis ka email `@test.local` par khatam na ho.

## Pehli dafa se pehle

gwadar-test par yeh migrations chal chuki hon (warna script error de kar ruk jayegi):

1. `migrations/20261118100000_business_region_vat_plan.sql`
2. `migrations/20261119000000_unstocked_sale_lines.sql`
3. `migrations/20261120000000_profit_before_vat.sql`

## Demo reset karna (jab bhi chahein)

1. Supabase mein upar baayen project ka naam dekhein: **gwadar-test**.
2. SQL Editor mein `demo-seed-dubai.sql` ki poori file paste karke **Run** dabayein.
3. Aakhir mein ek chhoti table aati hai: sales, rozana bikri (min/max/average), profit, returns, udhaar, stock, expenses.
4. App mein `owner@test.local` se login karein. Data dekhne ke liye dashboard ka period "Last 30 days" chunein.

Har dafa bilkul wohi data banta hai. Koi galti aaye to kuch bhi nahi badalta (sab ek transaction mein hai).

## Demo mein kya hai

- 15 phone models (iPhone, Galaxy, Redmi, Oppo) IMEI ke saath, 20 accessories
- 4 suppliers, 3 purchases phones ki (ek udhaar par, do aadhe paid) aur 1 accessories ki, 2 supplier payments
- 15 customers (050/052/054/055/056), ek company TRN ke saath
- Takreeban 80 invoices (rozana 2-3, kabhi 4): rozana ek phone (kabhi do), har phone ke saath 2-3 accessories, baqi invoices mein 3-6 accessories (charger, case, cable, AirPods, power bank). Kuch udhaar par (do ka baqi baad mein aaya, baqi abhi tak open)
- Margin (VAT se pehle): phones takreeban 8-12%, accessories takreeban 35-50%
- Andaza: 30 din ka profit takreeban AED 22,000-28,000, expenses (AED 14,514) ke baad takreeban AED 8,000-12,000. Aakhri summary table mein "profit after returns / after expenses" row asal number dikhati hai
- 3 "Item not in stock" sales, 2 returns (ek phone wapas stock mein, ek Apple Pencil)
- Expenses: kiraya, DEWA, du internet, 2 salaries, chhote kharche
- Cash AED 20,000 aur Emirates NBD AED 150,000 opening balance

Note: app tareekh aur waqt abhi Pakistan time mein dikhata hai, is liye invoice par waqt Dubai se 1 ghanta aage nazar aayega.

Note: seed ke baad business ka naam "Al Noor Mobiles" hai, is liye purani scripts `test-cleanup.sql` aur `test-seed-returns.sql` ab ruk jayengi. Demo ke liye hamesha yehi script chalayein.
