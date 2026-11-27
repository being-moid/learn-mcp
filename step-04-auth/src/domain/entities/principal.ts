// Who is calling, as established by an AuthProvider. Every request has one.
//
// Today the server has no sign-in, so every caller is the anonymous
// principal. From stage 2, a signed-in caller has their user ID and the
// organization they chose when they connected; their role and permissions are
// looked up per request on top of this.

export type Principal =
  | { kind: "anonymous" }
  | { kind: "user"; userId: string; organizationId: string };

export const ANONYMOUS: Principal = { kind: "anonymous" };
