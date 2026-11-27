-- Checks that the normalized tables (0004) hold the same sales as the
-- spreadsheet, and that the anomalies are gone. Run it with
--   npm run db:sql -- --branch dev db/queries/normalized-checks.sql
-- Every change is inside BEGIN ... ROLLBACK.

-- Row counts: 428 spreadsheet rows hold 435 order lines (7 cells had two products).
SELECT (SELECT count(*) FROM staging.flat_sales)::int AS flat_rows,
       (SELECT sum(cardinality(string_to_array(product_name, ','))) FROM staging.flat_sales)::int AS flat_lines,
       (SELECT count(*) FROM order_items WHERE org_id = 'demo')::int AS order_items,
       (SELECT count(*) FROM orders      WHERE org_id = 'demo')::int AS orders,
       (SELECT count(*) FROM customers   WHERE org_id = 'demo')::int AS customers,
       (SELECT count(*) FROM products    WHERE org_id = 'demo')::int AS products,
       (SELECT count(*) FROM categories  WHERE org_id = 'demo')::int AS categories;

-- Nothing lost: the spreadsheet's revenue (merged cells split inline, as 0002 did) equals the final tables'.
SELECT (SELECT sum(trim(cell.price)::numeric * trim(cell.quantity)::integer)
        FROM staging.flat_sales f
        CROSS JOIN LATERAL unnest(string_to_array(f.unit_price, ','), string_to_array(f.quantity, ',')) AS cell(price, quantity)) AS revenue_spreadsheet,
       (SELECT sum(unit_price * quantity) FROM order_items WHERE org_id = 'demo') AS revenue_tables;

-- One customer, one city, one email now.
SELECT name, email, city FROM customers
WHERE org_id = 'demo' AND name IN ('Corner Market', 'Bluebonnet Grocers') ORDER BY name;

-- One product, one category: Trail Mix is in Snacks.
SELECT p.name AS product, c.name AS category, p.list_price
FROM products p JOIN categories c ON (c.org_id, c.category_id) = (p.org_id, p.category_id)
WHERE p.org_id = 'demo' AND p.name IN ('Trail Mix 500g', 'Olive Oil 1L');

-- The copy on purpose: Olive Oil 1L sold at 11.99 before June and 12.99 after, though its list price is 12.99.
SELECT i.unit_price, count(*)::int AS lines, min(o.order_date) AS first_sale, max(o.order_date) AS last_sale
FROM order_items i
JOIN orders o   ON (o.org_id, o.order_id) = (i.org_id, i.order_id)
JOIN products p ON (p.org_id, p.product_id) = (i.org_id, i.product_id)
WHERE i.org_id = 'demo' AND p.name = 'Olive Oil 1L' GROUP BY i.unit_price ORDER BY first_sale;

-- Update anomaly gone: renaming a product is one row, and every order sees the new name.
BEGIN;
UPDATE products SET name = 'Sea Salt Kettle Chips 150g' WHERE org_id = 'demo' AND name = 'Kettle Chips 150g';
SELECT p.name, count(*)::int AS lines_sold FROM order_items i
JOIN products p ON (p.org_id, p.product_id) = (i.org_id, i.product_id)
WHERE i.org_id = 'demo' AND p.name LIKE '%Kettle Chips%' GROUP BY p.name;
ROLLBACK;

-- Insert anomaly gone: a product nobody has bought yet is just a product.
BEGIN;
INSERT INTO products (org_id, name, category_id, list_price)
SELECT 'demo', 'Coconut Water 1L', category_id, 3.49 FROM categories WHERE org_id = 'demo' AND name = 'Beverages';
SELECT name, list_price FROM products WHERE org_id = 'demo' AND name = 'Coconut Water 1L';
ROLLBACK;

-- Delete anomaly gone: cancel Old Town Grocer's only order, and the customer and the product remain.
BEGIN;
DELETE FROM orders WHERE org_id = 'demo' AND order_number = 'SO-0056';
SELECT (SELECT count(*) FROM customers WHERE org_id = 'demo' AND name = 'Old Town Grocer')::int AS old_town_grocer,
       (SELECT count(*) FROM products  WHERE org_id = 'demo' AND name = 'Olive Oil 5L (bulk)')::int AS bulk_olive_oil,
       (SELECT count(*) FROM orders    WHERE org_id = 'demo' AND order_number = 'SO-0056')::int AS the_order;
ROLLBACK;

-- The constraints refuse bad data: a quantity of 0...
INSERT INTO order_items (org_id, order_id, product_id, quantity, unit_price) VALUES ('demo', 1, 1, 0, 1.00);

-- ...an email with capitals...
INSERT INTO customers (org_id, name, email, city) VALUES ('demo', 'Shouty Shop', 'Owner@Shouty.example', 'Reno');

-- ...a second customer with the same email in the same company...
INSERT INTO customers (org_id, name, email, city) VALUES ('demo', 'Copycat Market', 'orders@cornermarket.example', 'Austin');

-- ...and, the company in every key: another company's order line can't point at the demo company's order 1 and product 1.
INSERT INTO order_items (org_id, order_id, product_id, quantity, unit_price) VALUES ('another-company', 1, 1, 5, 1.00);
