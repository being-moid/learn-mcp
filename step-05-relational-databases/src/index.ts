import { selectAccessService, selectAuthProvider, selectInvitationSignUpService, selectOutboxRelay } from "./composition";
import { ACCEPT_INVITATION_PATH, CONSENT_PATH, MCP_PATH, SELECT_ORGANIZATION_PATH, SIGN_IN_PATH } from "./infrastructure/auth/better-auth";
import { acceptInvitationPage, consentPage, selectOrganizationPage, signInPage } from "./presentation/http/auth-pages";
import { corsHeaders, rejectForeignHostOrOrigin, withCors } from "./presentation/http/guard";
import { handleInvitationRoute } from "./presentation/http/invitation-routes";
import { runAsCaller } from "./infrastructure/context/request-context";
import { callerToAuthInfo } from "./presentation/mcp/auth-info";
import { mcpHandler } from "./presentation/mcp/handler";

// The Worker's entry point. It only routes; each path's logic lives in its
// own module:
//   1. Host/Origin checks and CORS preflight, for every path
//   2. the sign-in, organization-picker, consent and accept-invitation pages,
//      and the invitation page's two endpoints (join by choosing a password)
//   3. the auth provider's own routes (OAuth endpoints, discovery documents)
//   4. /mcp: authenticate (valid token), check access (still a member, asked
//      of the database every time), then hand the request and its Principal to MCP
//
// It also runs the outbox relay: after every POST (changes arrive as POSTs),
// in the background once the response is on its way, and every minute from
// the Cron Trigger, which catches anything a kick missed or that failed.

// The Durable Object class must be exported from the Worker's main module.
export { NotificationHub } from "./infrastructure/notifications/hub";

export default {
  async fetch(request, _env, ctx) {
    const response = await route(request);
    if (request.method === "POST") ctx.waitUntil(relayOutbox("after-request"));
    return response;
  },

  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(relayOutbox("schedule"));
  },
} satisfies ExportedHandler<Env>;

/** Sends each request to the code for its path. */
async function route(request: Request): Promise<Response> {
  const rejected = rejectForeignHostOrOrigin(request);
  // A refused origin gets no CORS headers: its page can't read the refusal.
  if (rejected) return rejected;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });

  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === SIGN_IN_PATH) return signInPage();
  if (request.method === "GET" && pathname === SELECT_ORGANIZATION_PATH) return selectOrganizationPage();
  if (request.method === "GET" && pathname === CONSENT_PATH) return consentPage();
  if (request.method === "GET" && pathname === ACCEPT_INVITATION_PATH) return acceptInvitationPage();

  const invitationRoute = await handleInvitationRoute(request, pathname, selectInvitationSignUpService, selectAuthProvider);
  if (invitationRoute) return invitationRoute;

  const auth = selectAuthProvider();
  const authRoute = await auth.handleRoute(request);
  if (authRoute) return withCors(authRoute, request);

  if (pathname !== MCP_PATH) {
    return withCors(new Response("Not found. The MCP endpoint is /mcp.", { status: 404 }), request);
  }

  const result = await auth.authenticate(request);
  if (!result.ok) return withCors(result.response, request);

  const access = await selectAccessService().check(result.principal);
  if (!access.allowed) return withCors(accessDenied(access.reason), request);

  // The caller also goes into the request context, for the notification bus
  // (the one piece the MCP SDK calls without passing the request along).
  const caller = { principal: result.principal, membership: access.membership };
  const response = await runAsCaller(result.principal, () => mcpHandler.fetch(request, { authInfo: callerToAuthInfo(caller) }));
  return withCors(response, request);
}

/** One relay pass; failures are logged and retried on the next pass. */
async function relayOutbox(trigger: "after-request" | "schedule"): Promise<void> {
  try {
    const results = await selectOutboxRelay().runOnce();
    const busy = results.filter((r) => r.delivered || r.failed);
    if (busy.length) console.log(JSON.stringify({ outboxRelay: trigger, results: busy }));
  } catch (err) {
    console.error(JSON.stringify({ outboxRelay: trigger, error: err instanceof Error ? err.message : String(err) }));
  }
}

const ACCESS_DENIED_MESSAGES = {
  not_signed_in: "Sign in to use this server.",
  not_a_member: "You are no longer a member of the organization this connection uses. Reconnect and choose an organization you belong to.",
} as const;

function accessDenied(reason: keyof typeof ACCESS_DENIED_MESSAGES): Response {
  return Response.json({ error: reason, error_description: ACCESS_DENIED_MESSAGES[reason] }, { status: 403 });
}
