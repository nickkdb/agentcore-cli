/**
 * Bug-bash: GetResourceOauth2Token wrapper (token-status.ts)
 *
 * Probes all 10 branches specified in the bug-bash brief.
 * Uses vi.mock to replace the SDK so no real credentials are needed.
 */
import { getTokenStatus } from '../token-status.js';
import type { TokenStatusInput } from '../token-status.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── SDK mock ──────────────────────────────────────────────────────────────────
const mockSend = vi.fn();

// Tracks the input passed to the most recent GetResourceOauth2TokenCommand constructor
let lastCommandInput: Record<string, unknown> = {};

vi.mock('@aws-sdk/client-bedrock-agentcore', () => {
  class MockBedrockAgentCoreClient {
    send = mockSend;
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    constructor(_config: unknown) {}
  }

  // Must be a real class so `new GetResourceOauth2TokenCommand(...)` doesn't throw.
  // We capture the constructor argument via the module-level `lastCommandInput`.
  class MockGetResourceOauth2TokenCommand {
    constructor(input: Record<string, unknown>) {
      lastCommandInput = input;
    }
  }

  return {
    BedrockAgentCoreClient: MockBedrockAgentCoreClient,
    GetResourceOauth2TokenCommand: MockGetResourceOauth2TokenCommand,
  };
});

// ── Credential provider mock ──────────────────────────────────────────────────
vi.mock('../../../aws/account.js', () => ({
  getCredentialProvider: vi
    .fn()
    .mockReturnValue(() => Promise.resolve({ accessKeyId: 'test', secretAccessKey: 'test' })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
const baseInput: TokenStatusInput = {
  region: 'us-east-1',
  workloadIdentityToken: 'eyJhbGciOiJSUzI1NiJ9.test',
  resourceCredentialProviderName: 'my-provider',
  scopes: ['read'],
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('getTokenStatus — branch coverage', () => {
  beforeEach(() => {
    mockSend.mockReset();
    lastCommandInput = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 1. Fresh token branch
  it('returns { status: "fresh" } when accessToken is present, and does NOT expose the token', async () => {
    mockSend.mockResolvedValueOnce({ accessToken: 'secret-access-token-xyz' });

    const result = await getTokenStatus(baseInput);

    expect(result.status).toBe('fresh');
    // The token must NOT appear anywhere in the returned object
    expect(JSON.stringify(result)).not.toContain('secret-access-token-xyz');
    // TypeScript type guard: 'fresh' discriminant has no accessToken field
    // Runtime check — assert no unexpected keys leaked
    expect(Object.keys(result)).toEqual(['status']);
  });

  // 2. FAILED session
  it('returns { status: "failed", reason: "..." } when sessionStatus is FAILED', async () => {
    mockSend.mockResolvedValueOnce({ sessionStatus: 'FAILED' });

    const result = await getTokenStatus(baseInput);

    expect(result).toMatchObject({ status: 'failed' });
    if (result.status !== 'failed') throw new Error('narrowing');
    // Reason text must match the comment in service-contracts.md §5
    expect(result.reason).toBe('Authorization session failed; start a fresh consent flow.');
  });

  // 3. IN_PROGRESS with authorizationUrl — recent reorder fix: IN_PROGRESS wins over bare authorizationUrl
  it('returns { status: "inProgress", authorizationUrl } when IN_PROGRESS + authorizationUrl both present', async () => {
    mockSend.mockResolvedValueOnce({
      sessionStatus: 'IN_PROGRESS',
      authorizationUrl: 'https://idp.example.com/authorize?session=abc',
    });

    const result = await getTokenStatus(baseInput);

    expect(result).toMatchObject({
      status: 'inProgress',
      authorizationUrl: 'https://idp.example.com/authorize?session=abc',
    });
    // Must NOT be classified as needsConsent even though authorizationUrl is present
    expect(result.status).not.toBe('needsConsent');
  });

  // 4. IN_PROGRESS without authorizationUrl
  it('returns { status: "inProgress" } with no authorizationUrl when IN_PROGRESS alone', async () => {
    mockSend.mockResolvedValueOnce({ sessionStatus: 'IN_PROGRESS' });

    const result = await getTokenStatus(baseInput);

    expect(result.status).toBe('inProgress');
    // authorizationUrl must be absent (not set to undefined — key should not exist)
    expect('authorizationUrl' in result).toBe(false);
  });

  // 5. needsConsent — authorizationUrl only (no sessionStatus)
  it('returns { status: "needsConsent" } when only authorizationUrl + sessionUri present', async () => {
    mockSend.mockResolvedValueOnce({
      authorizationUrl: 'https://idp.example.com/authorize?new=1',
      sessionUri: 'urn:ietf:params:oauth:request_uri:abc123',
    });

    const result = await getTokenStatus(baseInput);

    expect(result).toMatchObject({
      status: 'needsConsent',
      authorizationUrl: 'https://idp.example.com/authorize?new=1',
      sessionUri: 'urn:ietf:params:oauth:request_uri:abc123',
    });
  });

  // 6. Catch-all — empty response
  it('returns { status: "failed", reason: "Unrecognized..." } on empty response', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await getTokenStatus(baseInput);

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('narrowing');
    expect(result.reason).toMatch(/Unrecognized/);
  });

  // 7a. SDK throws ResourceNotFoundException — must re-throw
  it('propagates ResourceNotFoundException from the SDK', async () => {
    const err = Object.assign(new Error('Provider not found'), { name: 'ResourceNotFoundException' });
    mockSend.mockRejectedValueOnce(err);

    await expect(getTokenStatus(baseInput)).rejects.toThrow('Provider not found');
  });

  // 7b. SDK throws ThrottlingException — must re-throw
  it('propagates ThrottlingException from the SDK', async () => {
    const err = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    mockSend.mockRejectedValueOnce(err);

    await expect(getTokenStatus(baseInput)).rejects.toThrow('Rate exceeded');
  });

  // 7c. SDK throws UnauthorizedException — must re-throw
  it('propagates UnauthorizedException from the SDK', async () => {
    const err = Object.assign(new Error('Invalid token'), { name: 'UnauthorizedException' });
    mockSend.mockRejectedValueOnce(err);

    await expect(getTokenStatus(baseInput)).rejects.toThrow('Invalid token');
  });

  // 8. Force-reauth flag — verify the SDK command is constructed with forceAuthentication: true
  it('passes forceAuthentication: true to the SDK command when specified', async () => {
    mockSend.mockResolvedValueOnce({ accessToken: 'tok' });

    await getTokenStatus({ ...baseInput, forceAuthentication: true });

    expect(lastCommandInput).toMatchObject({ forceAuthentication: true });
  });

  // 8b. forceAuthentication NOT passed when false/undefined — key must be absent
  it('omits forceAuthentication from the SDK command when not specified', async () => {
    mockSend.mockResolvedValueOnce({ accessToken: 'tok' });

    await getTokenStatus(baseInput); // no forceAuthentication

    expect(lastCommandInput).not.toHaveProperty('forceAuthentication');
  });

  // 9. oauth2Flow defaults to USER_FEDERATION when not specified
  it('defaults oauth2Flow to USER_FEDERATION', async () => {
    mockSend.mockResolvedValueOnce({ accessToken: 'tok' });

    await getTokenStatus(baseInput); // no oauth2Flow

    expect(lastCommandInput).toHaveProperty('oauth2Flow', 'USER_FEDERATION');
  });

  // 9b. oauth2Flow is passed through when explicitly specified
  it('respects an explicit oauth2Flow of M2M', async () => {
    mockSend.mockResolvedValueOnce({ accessToken: 'tok' });

    await getTokenStatus({ ...baseInput, oauth2Flow: 'M2M' });

    expect(lastCommandInput).toHaveProperty('oauth2Flow', 'M2M');
  });

  // 10a. Missing workloadIdentityToken — TypeScript guards at compile-time, but test runtime behaviour
  it('passes workloadIdentityToken through to the SDK command', async () => {
    mockSend.mockResolvedValueOnce({ accessToken: 'tok' });

    await getTokenStatus(baseInput);

    expect(lastCommandInput).toHaveProperty('workloadIdentityToken', baseInput.workloadIdentityToken);
  });

  // 10b. When the SDK rejects with ValidationException (what you'd get from empty/missing required fields)
  it('propagates ValidationException (e.g. missing required field) from the SDK', async () => {
    const err = Object.assign(new Error('workloadIdentityToken is required'), {
      name: 'ValidationException',
    });
    mockSend.mockRejectedValueOnce(err);

    // Callers get the raw SDK error — no sanitisation/wrapping happens
    await expect(getTokenStatus({ ...baseInput, workloadIdentityToken: '' })).rejects.toMatchObject({
      name: 'ValidationException',
    });
  });
});
