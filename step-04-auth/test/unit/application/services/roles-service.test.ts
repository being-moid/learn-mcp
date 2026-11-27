import { beforeEach, describe, expect, it } from "vitest";
import { RolesService, seedDefaultRoles } from "../../../../src/application/services/roles-service";
import { ForbiddenError, GuardrailError, NotFoundError } from "../../../../src/domain/errors";
import { InMemoryRoleRepository } from "../../../fakes/in-memory-role-repository";
import { membership } from "../../../fakes/memberships";

describe("RolesService", () => {
  let repo: InMemoryRoleRepository;
  const as = (builtin: "owner" | "admin" | "member", permissions?: Parameters<typeof membership>[3]) =>
    new RolesService(repo, membership(`${builtin}-user`, "org-1", builtin, permissions));

  beforeEach(async () => {
    repo = new InMemoryRoleRepository();
    await seedDefaultRoles(repo);
    repo.assignments.set("owner-user", "role-owner");
    repo.assignments.set("admin-user", "role-admin");
    repo.assignments.set("member-user", "role-member");
  });

  it("seeds the three default roles once", async () => {
    await seedDefaultRoles(repo);
    expect(repo.roles.map((r) => `${r.builtin}:${r.name}:${r.permissions.length}`)).toEqual(["owner:Owner:7", "admin:Admin:7", "member:Member:3"]);
  });

  describe("permissions on every action", () => {
    it("lets a member do none of the role actions", async () => {
      const member = as("member");
      await expect(member.list()).rejects.toThrow(ForbiddenError);
      await expect(member.create("Viewer", ["notes:read"])).rejects.toThrow(ForbiddenError);
      await expect(member.setPermissions("role-member", ["notes:read"])).rejects.toThrow(ForbiddenError);
      await expect(member.assign("member-user", "role-member")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("guardrail 1: you can't grant what you don't hold", () => {
    const limited = () => as("admin", ["members:read", "roles:manage", "notes:read"]);

    it("refuses to create or change a role with permissions the caller lacks", async () => {
      await expect(limited().create("Writer", ["notes:write"])).rejects.toThrow(/don't have yourself: notes:write/);
      await expect(limited().setPermissions("role-member", ["notes:delete"])).rejects.toThrow(GuardrailError);
    });

    it("refuses to give someone a role with more than the caller has", async () => {
      await expect(limited().assign("member-user", "role-admin")).rejects.toThrow(GuardrailError);
    });

    it("allows what the caller does hold", async () => {
      const role = await limited().create("Viewer", ["notes:read"]);
      expect(role.permissions).toEqual(["notes:read"]);
    });
  });

  describe("guardrail 2: an organization keeps at least one Owner", () => {
    it("refuses to demote the last Owner", async () => {
      await expect(as("owner").assign("owner-user", "role-admin")).rejects.toThrow(/at least one Owner/);
    });

    it("allows demoting an Owner once there is another", async () => {
      await as("owner").assign("admin-user", "role-owner");
      await expect(as("owner").assign("owner-user", "role-admin")).resolves.toMatchObject({ builtin: "admin" });
    });
  });

  it("guardrail 3: the Owner role's permissions can't be changed", async () => {
    await expect(as("owner").setPermissions("role-owner", ["notes:read"])).rejects.toThrow(/Owner role/);
  });

  it("guardrail 4: only an Owner can make someone an Owner", async () => {
    await expect(as("admin").assign("member-user", "role-owner")).rejects.toThrow(/Only an Owner/);
    await expect(as("owner").assign("member-user", "role-owner")).resolves.toMatchObject({ builtin: "owner" });
  });

  describe("bad input", () => {
    it("rejects unknown permissions, duplicate and empty names", async () => {
      await expect(as("owner").create("Odd", ["notes:read", "launch:rockets"])).rejects.toThrow(/Unknown permission/);
      await expect(as("owner").create("Member", ["notes:read"])).rejects.toThrow(/already has a role/);
      await expect(as("owner").create("   ", ["notes:read"])).rejects.toThrow(/1 to 50/);
    });

    it("reports a missing role or a non-member", async () => {
      await expect(as("owner").setPermissions("no-such-role", [])).rejects.toThrow(NotFoundError);
      await expect(as("owner").assign("stranger", "role-member")).rejects.toThrow(/isn't a member/);
    });
  });
});

describe("RolesService.remove (guardrail 5)", () => {
  let repo: InMemoryRoleRepository;
  const as = (userId: string, builtin: "owner" | "admin" | "member", permissions?: Parameters<typeof membership>[3]) =>
    new RolesService(repo, membership(userId, "org-1", builtin, permissions));

  beforeEach(async () => {
    repo = new InMemoryRoleRepository();
    await seedDefaultRoles(repo);
    repo.assignments.set("owner-1", "role-owner");
    repo.assignments.set("owner-2", "role-owner");
    repo.assignments.set("admin-1", "role-admin");
    repo.assignments.set("member-1", "role-member");
  });

  it("lets an Owner or Admin remove a Member", async () => {
    await as("admin-1", "admin").remove("member-1");
    expect(repo.assignments.has("member-1")).toBe(false);
  });

  it("needs members:remove", async () => {
    await expect(as("member-1", "member").remove("admin-1")).rejects.toThrow(ForbiddenError);
  });

  it("never removes yourself, or someone who isn't a member", async () => {
    await expect(as("owner-1", "owner").remove("owner-1")).rejects.toThrow(/can't remove yourself/);
    await expect(as("owner-1", "owner").remove("nobody")).rejects.toThrow(NotFoundError);
  });

  it("lets only an Owner remove an Owner, and always keeps one", async () => {
    await expect(as("admin-1", "admin").remove("owner-1")).rejects.toThrow(/Only an Owner can remove an Owner/);
    await as("owner-1", "owner").remove("owner-2");
    expect(await repo.countOwners()).toBe(1);
  });

  it("won't let someone remove a person whose role has more than they hold", async () => {
    const limited = as("admin-1", "admin", ["members:read", "members:remove"]);
    await expect(limited.remove("member-1")).rejects.toThrow(GuardrailError);
  });
});
