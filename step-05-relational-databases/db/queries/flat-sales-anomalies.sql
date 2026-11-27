-- The flat spreadsheet's problems, shown with queries. Run it with
--   npm run db:sql -- --branch dev db/queries/flat-sales-anomalies.sql
-- Predict each answer before you look. Every change is inside BEGIN ...
-- ROLLBACK, so the branch ends exactly as it started.

-- How big is it? Rows, orders, and how many different ways customers and products are written.
SELECT count(*) AS rows, count(DISTINCT order_number) AS orders,
       count(DISTINCT customer_name) AS customer_names, count(DISTINCT product_name) AS product_cells
FROM staging.flat_sales;

-- 1NF: cells holding more than one value (two products, two prices, two quantities).
SELECT row_number, order_number, product_name, unit_price, quantity
FROM staging.flat_sales WHERE product_name LIKE '%,%' ORDER BY row_number;

-- ...so even a simple total fails: "4.29, 2.49" is not a number.
SELECT sum(unit_price::numeric * quantity::integer) AS revenue FROM staging.flat_sales;

-- UPDATE ANOMALY, already in the data: Corner Market moved in June, and the
-- city was retyped on each new row. Some rows were copied from old ones, so
-- the sheet now says both. Which city is right? The data can't tell you.
SELECT customer_name, customer_city, count(*) AS rows, min(order_date) AS first_order, max(order_date) AS last_order
FROM staging.flat_sales WHERE customer_name = 'Corner Market'
GROUP BY customer_name, customer_city ORDER BY first_order;

-- The same disease: one customer, two emails...
SELECT customer_name, customer_email, count(*) AS rows
FROM staging.flat_sales WHERE customer_name = 'Bluebonnet Grocers' GROUP BY 1, 2;

-- ...and one product, two categories (so "sales by category" depends on who typed the row).
SELECT product_name, category, count(*) AS rows
FROM staging.flat_sales WHERE product_name = 'Trail Mix 500g' GROUP BY 1, 2;

-- UPDATE ANOMALY, made on purpose: the supplier renames Kettle Chips. The name
-- is stored on every row that sold it, so the rename has to find them all.
-- This one only updates this year's rows (a WHERE that looked reasonable)...
BEGIN;
UPDATE staging.flat_sales SET product_name = 'Sea Salt Kettle Chips 150g'
WHERE product_name = 'Kettle Chips 150g' AND order_date >= '2026-01-01';
-- ...and now the same product has two names. (The merged cells weren't touched either.)
SELECT product_name, count(*) AS rows FROM staging.flat_sales
WHERE product_name LIKE '%Kettle Chips 150g%' GROUP BY 1 ORDER BY 1;
ROLLBACK;

-- INSERT ANOMALY: Stockroom adds Coconut Water to the catalog before anyone
-- buys it. A row here is an order line, so there is nowhere to put a product
-- without an order: the insert fails (or you'd have to invent a fake order).
BEGIN;
INSERT INTO staging.flat_sales (row_number, product_name, category, unit_price)
VALUES (429, 'Coconut Water 1L', 'Beverages', '3.49');
ROLLBACK;

-- The same goes for a new customer who hasn't ordered yet: no order, no row.

-- DELETE ANOMALY: Old Town Grocer placed one order, the only sale of the bulk
-- olive oil. Look at it first...
SELECT row_number, order_number, order_date, customer_name, customer_city, product_name, unit_price, quantity
FROM staging.flat_sales WHERE order_number = 'SO-0056';

-- ...then cancel that order (delete its line)...
BEGIN;
DELETE FROM staging.flat_sales WHERE order_number = 'SO-0056';
-- ...and the customer and the product are gone with it: nothing remembers they exist.
SELECT (SELECT count(*) FROM staging.flat_sales WHERE customer_name = 'Old Town Grocer') AS old_town_grocer_rows,
       (SELECT count(*) FROM staging.flat_sales WHERE product_name LIKE '%Olive Oil 5L%') AS bulk_olive_oil_rows;
ROLLBACK;

-- Back to how it started.
SELECT count(*) AS rows FROM staging.flat_sales;
