-- 0005: drop the in-between tables of the normalization walkthrough.
--
-- staging.sales_1nf (0002) and the three 2NF tables (0003) showed the data at
-- each normal form, and 0004 copied it from them into the final tables.
-- Nothing reads them any more, and keeping them would mean two copies of the
-- demo sales, and two places someone could mistake for the real data. The
-- migrations that made them stay, unchanged: they are the record of how the
-- design was reached, and running all migrations on a fresh branch still
-- rebuilds and then drops them.
--
-- staging.flat_sales stays: compare_designs runs questions against it to
-- show what the flat design gets wrong.

DROP TABLE staging.order_lines_2nf;
DROP TABLE staging.orders_2nf;
DROP TABLE staging.products_2nf;
DROP TABLE staging.sales_1nf;
