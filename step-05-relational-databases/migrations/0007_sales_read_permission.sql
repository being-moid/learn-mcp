-- Step 05: the notes (and their notes:read, notes:write and notes:delete
-- permissions) are replaced by sales data in Neon, read with "sales:read".
-- Any role that could read notes can read sales; then the notes permissions
-- are removed, so no role keeps a permission the server no longer knows.
-- (A fresh step 05 database has no roles yet; this is for a copied one.)
INSERT OR IGNORE INTO "org_role_permission" ("roleId", "permission")
SELECT "roleId", 'sales:read' FROM "org_role_permission" WHERE "permission" = 'notes:read';

DELETE FROM "org_role_permission" WHERE "permission" IN ('notes:read', 'notes:write', 'notes:delete');
