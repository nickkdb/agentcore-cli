import type { CredentialType } from '../../../../schema';

// ─────────────────────────────────────────────────────────────────────────────
// Identity Flow Types
// ─────────────────────────────────────────────────────────────────────────────

export type AddIdentityStep =
  | 'type'
  | 'name'
  | 'apiKey'
  | 'oauthMode'
  | 'discoveryUrl'
  | 'authorizationUrl'
  | 'tokenUrl'
  | 'clientId'
  | 'clientSecret'
  | 'scopes'
  | 'confirm';

/**
 * For OAuth credentials, the wizard branches: 'discovery' uses an OIDC
 * discoveryUrl (covers all standard vendors); 'manual' captures
 * authorizationUrl + tokenUrl (for CustomOauth2 vendors that back 3LO
 * targets without OIDC discovery).
 */
export type OAuthEndpointMode = 'discovery' | 'manual';

export interface AddIdentityConfig {
  identityType: CredentialType;
  name: string;
  /** API Key (when type is ApiKeyCredentialProvider) */
  apiKey: string;
  /** OAuth fields (when type is OAuthCredentialProvider) */
  oauthMode?: OAuthEndpointMode;
  discoveryUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string;
}

export const IDENTITY_STEP_LABELS: Record<AddIdentityStep, string> = {
  type: 'Type',
  name: 'Name',
  apiKey: 'API Key',
  oauthMode: 'OAuth Mode',
  discoveryUrl: 'Discovery URL',
  authorizationUrl: 'Authorization URL',
  tokenUrl: 'Token URL',
  clientId: 'Client ID',
  clientSecret: 'Client Secret',
  scopes: 'Scopes',
  confirm: 'Confirm',
};

// ─────────────────────────────────────────────────────────────────────────────
// UI Option Constants
// ─────────────────────────────────────────────────────────────────────────────

export const IDENTITY_TYPE_OPTIONS = [
  { id: 'ApiKeyCredentialProvider' as const, title: 'API Key', description: 'Store and manage API key credentials' },
  { id: 'OAuthCredentialProvider' as const, title: 'OAuth', description: 'OAuth 2.0 client credentials' },
] as const;
