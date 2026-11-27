import type { Permission } from "./permissions";

// Errors the application layer raises for reasons a caller can understand.
// The presentation layer turns them into clear, recoverable tool errors.

/** The caller's role doesn't include the permission this action needs. */
export class ForbiddenError extends Error {
  constructor(readonly permission: Permission) {
    super(`Your role doesn't allow this (it needs the "${permission}" permission). Ask an Owner or Admin of your organization.`);
  }
}

/** The action would break one of the organization's rules (e.g. leave it without an Owner). */
export class GuardrailError extends Error {}

/** The thing asked for doesn't exist in the caller's organization. */
export class NotFoundError extends Error {}
