import type { AuthInfo } from "@modelcontextprotocol/server";
import type { Membership } from "../../domain/entities/membership";
import type { Principal } from "../../domain/entities/principal";

// Carries the caller (who they are, and their current membership: role and
// permissions) from the checks in index.ts to the per-request factory
// (handler.ts). The MCP SDK passes `authInfo` from
// handler.fetch(request, { authInfo }) through to the factory as ctx.authInfo.

export interface Caller {
  principal: Principal;
  membership: Membership;
}

export function callerToAuthInfo(caller: Caller, token = ""): AuthInfo {
  return {
    token,
    clientId: caller.principal.kind === "user" ? caller.principal.userId : "anonymous",
    scopes: [],
    extra: { caller },
  };
}

/**
 * Fails closed: a request that reached the MCP handler without having been
 * authenticated and checked is a bug, never "anonymous by default".
 */
export function callerFromAuthInfo(authInfo: AuthInfo | undefined): Caller {
  const caller = authInfo?.extra?.caller as Caller | undefined;
  if (!caller?.principal || !caller.membership) throw new Error("MCP request reached the handler without an authenticated, checked caller");
  return caller;
}
