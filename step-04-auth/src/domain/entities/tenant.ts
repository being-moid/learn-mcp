// A tenant: a Stockroom customer account. It owns one or more organizations
// (for example a distributor's regional branches). Data is isolated per
// organization; the tenant groups them for management.

export interface Tenant {
  id: string;
  name: string;
  createdAt: string;
}

/** The person signing up, as onboarding needs them. */
export interface NewUser {
  id: string;
  name: string;
  email: string;
}
