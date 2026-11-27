import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "../../domain/entities/principal";

// The caller of the request currently being handled, for the few pieces of
// infrastructure the MCP SDK calls without passing the request along (the
// change-notification event bus). Everything else receives the Principal
// explicitly, through the composition root.
//
// index.ts sets it around each authenticated /mcp request. It is
// request-scoped, not module state: AsyncLocalStorage keeps a separate value
// for every request, across awaits.

const storage = new AsyncLocalStorage<Principal>();

/** Runs `work` with `principal` as the current caller. */
export function runAsCaller<T>(principal: Principal, work: () => T): T {
  return storage.run(principal, work);
}

/** The current caller, or undefined outside an authenticated /mcp request. */
export function currentCaller(): Principal | undefined {
  return storage.getStore();
}
