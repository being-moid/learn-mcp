import { env } from "cloudflare:workers";
import type { ServerEventBus } from "@modelcontextprotocol/server";
import { AccessService } from "./application/services/access-service";
import { AccountEmails } from "./application/services/account-emails";
import { InvitationEmailConsumer } from "./application/services/invitation-email-consumer";
import { InvitationSignUpService } from "./application/services/invitation-sign-up-service";
import { OutboxRelay } from "./application/services/outbox-relay";
import { MembersService } from "./application/services/members-service";
import { OnboardingService } from "./application/services/onboarding-service";
import { OrganizationChoiceService } from "./application/services/organization-choice-service";
import { RolesService, seedDefaultRoles } from "./application/services/roles-service";
import type { Membership } from "./domain/entities/membership";
import type { Principal } from "./domain/entities/principal";
import type { AuthProvider } from "./domain/ports/auth/auth-provider";
import type { EmailSender } from "./domain/ports/notifications/email-sender";
import type { BusinessDatabaseStatusReader } from "./domain/ports/persistence/business-database-status";
import { readAuthSecret, type AuthSecretBindings } from "./infrastructure/auth/auth-secret";
import type { AuthLifecycle } from "./infrastructure/auth/better-auth";
import { BetterAuthPasswordHasher } from "./infrastructure/auth/better-auth-password-hasher";
import { BetterAuthProvider, type BetterAuthProviderBindings } from "./infrastructure/auth/better-auth-provider";
import { HmacInvitationLinkTokens } from "./infrastructure/auth/hmac-invitation-link-tokens";
import { LogEmailSender } from "./infrastructure/email/log-email-sender";
import { RecordingEmailSender } from "./infrastructure/email/recording-email-sender";
import { ResendEmailSender } from "./infrastructure/email/resend-email-sender";
import { HubEventBus } from "./infrastructure/notifications/event-bus";
import { D1InvitationRepository, D1InvitationStatusReader } from "./infrastructure/persistence/d1/d1-invitation-repository";
import { D1InvitationSignUpRepository } from "./infrastructure/persistence/d1/d1-invitation-sign-up-repository";
import { D1OutboxStore } from "./infrastructure/persistence/d1/d1-outbox-store";
import { D1MembershipReader } from "./infrastructure/persistence/d1/d1-membership-reader";
import { D1RoleRepository } from "./infrastructure/persistence/d1/d1-role-repository";
import { D1TenantRepository } from "./infrastructure/persistence/d1/d1-tenant-repository";
import { FixedDatabaseStatusReader } from "./infrastructure/persistence/memory/fixed-database-status";
import { NeonDatabaseStatusReader } from "./infrastructure/persistence/neon/neon-database-status";

// The composition root: the only place that chooses concrete implementations
// for the ports and wires them into services. Everything else depends on the
// interfaces in domain/ports.
//
// To switch authentication or the database for the whole codebase, change the
// class returned below. Nothing else changes.

/** Which authentication implementation the Worker uses. */
export function selectAuthProvider(): AuthProvider {
  // `env` is cast because the test-only secret binding (AUTH_SECRET_FOR_TESTS)
  // exists only in the Vitest config, not in the generated Env type.
  return new BetterAuthProvider(env as unknown as BetterAuthProviderBindings, authLifecycle()); // was: new AnonymousAuthProvider()
}

/**
 * What happens at moments in a user's life (sign-up, new session,
 * connecting), wired to OnboardingService. Better Auth's hooks call this.
 */
function authLifecycle(): AuthLifecycle {
  const memberships = new D1MembershipReader(env.AUTH_DB);
  const tenants = new D1TenantRepository(env.AUTH_DB);
  const choice = new OrganizationChoiceService(memberships);
  const emails = new AccountEmails(selectEmailSender());
  return {
    sendVerificationEmail: (input) => emails.sendVerification(input),
    onboard: async (user, identity) => {
      await new OnboardingService(identity, memberships, tenants).onboard(user);
    },
    onOrganizationCreated: (organizationId) => seedDefaultRoles(new D1RoleRepository(env.AUTH_DB, organizationId)),
    defaultOrganizationFor: (userId) => choice.defaultOrganizationFor(userId),
    mustChooseOrganization: (userId) => choice.mustChoose(userId),
  };
}

/**
 * Which email sender the Worker uses: Resend, with its API key from the
 * Secrets Store. Tests set EMAIL_SENDER_FOR_TESTS (in vitest.config.ts only)
 * and get a recorder instead, so they never send real email.
 */
export function selectEmailSender(): EmailSender {
  const bindings = env as unknown as { EMAIL_SENDER_FOR_TESTS?: string; EMAIL_DELIVERY?: string };
  if (bindings.EMAIL_SENDER_FOR_TESTS === "record") return new RecordingEmailSender();
  // Staging (wrangler.jsonc env.staging) logs instead of sending.
  if (bindings.EMAIL_DELIVERY === "log") return new LogEmailSender();
  return new ResendEmailSender(() => env.RESEND_API_KEY.get(), {
    invitation: env.EMAIL_FROM_INVITATIONS,
    notification: env.EMAIL_FROM_NOTIFICATIONS,
  });
}

/**
 * The outbox relay and its consumers. Add a consumer here (Neon's inbox in
 * step 05) and it receives events from its own starting point onward.
 */
export function selectOutboxRelay(): OutboxRelay {
  const consumers = [
    new InvitationEmailConsumer({
      memberships: new D1MembershipReader(env.AUTH_DB),
      invitations: new D1InvitationStatusReader(env.AUTH_DB),
      emails: new AccountEmails(selectEmailSender()),
      tokens: selectInvitationLinkTokens(),
      publicUrl: env.PUBLIC_URL,
    }),
  ];
  return new OutboxRelay(new D1OutboxStore(env.AUTH_DB), consumers);
}

/** The secret in invitation links, keyed by the auth secret (Secrets Store; test override in Vitest). */
function selectInvitationLinkTokens(): HmacInvitationLinkTokens {
  return new HmacInvitationLinkTokens(() => readAuthSecret(env as unknown as AuthSecretBindings));
}

/** Joining from an invitation link by choosing a password (the /accept-invitation page). */
export function selectInvitationSignUpService(): InvitationSignUpService {
  return new InvitationSignUpService({
    invitations: new D1InvitationSignUpRepository(env.AUTH_DB),
    tokens: selectInvitationLinkTokens(),
    passwords: new BetterAuthPasswordHasher(),
    memberships: new D1MembershipReader(env.AUTH_DB),
  });
}

/** Decides, on every request, whether an authenticated caller is still a member. */
export function selectAccessService(): AccessService {
  return new AccessService(new D1MembershipReader(env.AUTH_DB));
}

/**
 * Which event bus carries change notifications to listening clients. It is
 * created once, with the module-level MCP handler.
 */
export function selectEventBus(): ServerEventBus {
  return new HubEventBus(); // the NotificationHub Durable Object
}

/**
 * The business database: Neon Postgres (D1 stays for auth only). Tests set
 * DATABASE_FOR_TESTS (in vitest.config.ts only) and get a fixed stand-in,
 * because the Workers-runtime tests can't reach a real database.
 */
function selectBusinessDatabaseStatus(): BusinessDatabaseStatusReader {
  const bindings = env as unknown as { DATABASE_FOR_TESTS?: string };
  if (bindings.DATABASE_FOR_TESTS === "memory") return new FixedDatabaseStatusReader();
  return new NeonDatabaseStatusReader(env);
}

/** Everything the presentation layer (tools, resources, prompts) may use, for one caller. */
export interface Services {
  /** Who is calling and what their role allows, as checked on this request. */
  caller: Membership;
  /** The business database's status (Neon). */
  businessDatabase: BusinessDatabaseStatusReader;
  roles: RolesService;
  members: MembersService;
}

/**
 * Builds one request's services for the caller. Runs once per request (from
 * the MCP handler's factory), so nothing request-shaped lives in module scope,
 * and every repository comes back already scoped to `principal`.
 */
export function buildServices(principal: Principal, membership: Membership): Services {
  void principal; // scopes the sales repositories (prompt 6); today every service is scoped by `membership`
  return {
    caller: membership,
    businessDatabase: selectBusinessDatabaseStatus(),
    // Built for the caller's organization only: it can't reach another's roles.
    roles: new RolesService(new D1RoleRepository(env.AUTH_DB, membership.organizationId), membership),
    members: new MembersService(
      {
        memberships: new D1MembershipReader(env.AUTH_DB),
        // Built for the caller's organization only.
        invitations: new D1InvitationRepository(env.AUTH_DB, membership.organizationId),
      },
      membership,
    ),
  };
}
