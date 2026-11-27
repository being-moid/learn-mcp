-- 0002: first normal form (1NF).
--
-- The rule: every cell holds one value, and there are no repeating groups.
-- A row is identified by a key, and each column has one type.
--
-- What breaks it in staging.flat_sales: 7 rows put two products in one cell,
-- with two categories, two prices and two quantities to match
-- ("Rolled Oats 1kg, Kettle Chips 150g" | "4.29, 2.49" | "5, 6"). Because a
-- cell can hold a list, unit_price and quantity had to be text, and no total
-- could be computed.
--
-- The fix: split each list into one row per product, and give price and
-- quantity real types. The key becomes (order_number, product_name): an
-- order lists each product once. Customer and product details are still
-- repeated on every row; 1NF doesn't fix that (2NF and 3NF do).

CREATE TABLE staging.sales_1nf (
  order_number   text          NOT NULL,
  order_date     date          NOT NULL,
  customer_name  text          NOT NULL,
  customer_email text          NOT NULL,
  customer_city  text          NOT NULL,
  product_name   text          NOT NULL,
  category       text          NOT NULL,
  unit_price     numeric(10,2) NOT NULL,
  quantity       integer       NOT NULL,
  PRIMARY KEY (order_number, product_name)
);

-- unnest() with several arrays walks them side by side: the first product
-- goes with the first category, price and quantity, and so on. A row with
-- one product gives a one-element array, so it comes through unchanged.
INSERT INTO staging.sales_1nf
  (order_number, order_date, customer_name, customer_email, customer_city, product_name, category, unit_price, quantity)
SELECT f.order_number, f.order_date, f.customer_name, f.customer_email, f.customer_city,
       trim(cell.product), trim(cell.category), trim(cell.price)::numeric(10,2), trim(cell.quantity)::integer
FROM staging.flat_sales AS f
CROSS JOIN LATERAL unnest(
  string_to_array(f.product_name, ','),
  string_to_array(f.category, ','),
  string_to_array(f.unit_price, ','),
  string_to_array(f.quantity, ',')
) AS cell(product, category, price, quantity);
