export type FetchResourceType = 'gateway' | 'agent';

export interface FetchAccessOptions {
  name?: string;
  type?: FetchResourceType;
  target?: string;
  identityName?: string;
  json?: boolean;
  /**
   * When set together with --name, treat the request as a gateway-target
   * lookup and dispatch to the 3LO outbound-status helper. The target's
   * grantType determines the response shape: 2LO targets share the
   * gateway-level token path; 3LO targets return a discriminated
   * TokenStatus union (fresh / inProgress / needsConsent / failed).
   */
  targetName?: string;
  /** Force a new consent session by setting forceAuthentication=true. */
  forceReauth?: boolean;
}
