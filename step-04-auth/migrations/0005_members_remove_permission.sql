-- Step 04, stage 8: the new "members:remove" permission (the remove_member
-- tool). New organizations get it through the default Owner and Admin roles
-- (src/domain/permissions.ts); this grants it to the built-in Owner and Admin
-- roles of organizations that already exist. Custom roles are left alone:
-- an Owner decides whether to add it to them.
INSERT OR IGNORE INTO "org_role_permission" ("roleId", "permission")
SELECT "id", 'members:remove' FROM "org_role" WHERE "builtin" IN ('owner', 'admin');
