import type { InvitationSignUpService } from "../../application/services/invitation-sign-up-service";
import { GuardrailError, NotFoundError } from "../../domain/errors";
import type { AuthProvider } from "../../domain/ports/auth/auth-provider";

// The two JSON endpoints behind the /accept-invitation page, for someone
// without an account:
//   POST /invitations/preview  { invitationId, token }            -> who invited them, to what
//   POST /invitations/join     { invitationId, token, password }  -> account created, signed in
// The token comes from the email link's fragment (after "#"), which the page
// reads and sends in the body, so it never appears in a URL the server logs.
// Like every POST, these pass the Host/Origin check first (index.ts), so
// another site can't call them from someone's browser.

export const INVITATION_PREVIEW_PATH = "/invitations/preview";
export const INVITATION_JOIN_PATH = "/invitations/join";

export async function handleInvitationRoute(
  request: Request,
  pathname: string,
  service: () => InvitationSignUpService,
  auth: () => AuthProvider,
): Promise<Response | undefined> {
  if (request.method !== "POST" || (pathname !== INVITATION_PREVIEW_PATH && pathname !== INVITATION_JOIN_PATH)) return undefined;

  const body = (await request.json().catch(() => null)) as { invitationId?: unknown; token?: unknown; password?: unknown } | null;
  const invitationId = typeof body?.invitationId === "string" ? body.invitationId.slice(0, 100) : "";
  const token = typeof body?.token === "string" ? body.token.slice(0, 100) : "";

  try {
    if (pathname === INVITATION_PREVIEW_PATH) return json(await service().preview(invitationId, token));

    const password = typeof body?.password === "string" ? body.password : "";
    const joined = await service().join(invitationId, token, password);
    // Sign them in straight away, through the auth provider like any sign-in.
    const cookies = (await auth().signIn(request, joined.email, password)) ?? [];
    const response = json({ ...joined, signedIn: cookies.length > 0 });
    for (const cookie of cookies) response.headers.append("set-cookie", cookie);
    return response;
  } catch (err) {
    if (err instanceof NotFoundError) return json({ message: err.message }, 404);
    if (err instanceof GuardrailError) return json({ message: err.message }, 400);
    throw err;
  }
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}
