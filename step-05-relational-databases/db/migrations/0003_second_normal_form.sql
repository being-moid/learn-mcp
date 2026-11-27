-- 0003: second normal form (2NF).
--
-- The rule: in a table whose key has more than one column, every other
-- column depends on the whole key, not on part of it.
--
-- What breaks it in staging.sales_1nf, whose key is (order_number, product_name):
--   - order_date, customer_name, customer_email and customer_city depend on
--     order_number alone: they're facts about the order, repeated on each of
--     its lines.
--   - category depends on product_name alone: it's a fact about the product,
--     repeated on every line that sold it.
--   - unit_price and quantity depend on the whole key: how many of this
--     product were on this order, at what price. They stay.
--
-- The fix: one table per thing the facts describe. Orders keep the order
-- facts, products keep the product facts, and order lines keep only what
-- needs both. Splitting forces a choice wherever the copies disagreed:
--   - Trail Mix was filed under Snacks on 17 lines and Pantry on 5. A product
--     now has one category: the one most lines used (Snacks).
--   - A product now has a list price, its catalog price today: the price on
--     its most recent sale. The price each line was sold at stays on the line
--     (see 0004 for why that copy is kept on purpose).
-- The customer facts are still repeated, once per order now; that's 3NF's job.

CREATE TABLE staging.orders_2nf (
  order_number   text PRIMARY KEY,
  order_date     date NOT NULL,
  customer_name  text NOT NULL,
  customer_email text NOT NULL,
  customer_city  text NOT NULL
);

CREATE TABLE staging.products_2nf (
  product_name text          PRIMARY KEY,
  category     text          NOT NULL,
  list_price   numeric(10,2) NOT NULL
);

CREATE TABLE staging.order_lines_2nf (
  order_number text          NOT NULL REFERENCES staging.orders_2nf (order_number),
  product_name text          NOT NULL REFERENCES staging.products_2nf (product_name),
  unit_price   numeric(10,2) NOT NULL,
  quantity     integer       NOT NULL,
  PRIMARY KEY (order_number, product_name)
);

-- Each order's facts were typed the same on all its lines, so DISTINCT gives
-- exactly one row per order (the primary key would refuse a second).
INSERT INTO staging.orders_2nf (order_number, order_date, customer_name, customer_email, customer_city)
SELECT DISTINCT order_number, order_date, customer_name, customer_email, customer_city
FROM staging.sales_1nf;

-- mode() picks the most common category; the array, ordered newest first,
-- gives the latest price.
INSERT INTO staging.products_2nf (product_name, category, list_price)
SELECT product_name,
       mode() WITHIN GROUP (ORDER BY category),
       (array_agg(unit_price ORDER BY order_date DESC, order_number DESC))[1]
FROM staging.sales_1nf
GROUP BY product_name;

INSERT INTO staging.order_lines_2nf (order_number, product_name, unit_price, quantity)
SELECT order_number, product_name, unit_price, quantity
FROM staging.sales_1nf;
