import { buildCredentialScopesIndex, resolveEffectiveScopes } from '../resolve-effective-scopes';
import { describe, expect, it } from 'vitest';

describe('resolveEffectiveScopes', () => {
  it('uses target scopes when present', () => {
    expect(resolveEffectiveScopes(['t1', 't2'], ['c1'])).toEqual(['t1', 't2']);
  });

  it('falls back to credential scopes when target scopes are undefined', () => {
    expect(resolveEffectiveScopes(undefined, ['c1', 'c2'])).toEqual(['c1', 'c2']);
  });

  it('falls back to credential scopes when target scopes are an empty array', () => {
    expect(resolveEffectiveScopes([], ['c1'])).toEqual(['c1']);
  });

  it('returns [] when neither side has scopes', () => {
    expect(resolveEffectiveScopes(undefined, undefined)).toEqual([]);
    expect(resolveEffectiveScopes([], [])).toEqual([]);
  });

  it('returns a fresh array (defensive copy)', () => {
    const target = ['t1'];
    const result = resolveEffectiveScopes(target, undefined);
    expect(result).not.toBe(target);
    expect(result).toEqual(target);
  });
});

describe('buildCredentialScopesIndex', () => {
  it('indexes only OAuthCredentialProvider credentials with non-empty scopes', () => {
    const idx = buildCredentialScopesIndex({
      credentials: [
        { authorizerType: 'OAuthCredentialProvider', name: 'a', vendor: 'GoogleOauth2', scopes: ['x', 'y'] },
        { authorizerType: 'OAuthCredentialProvider', name: 'b', vendor: 'GoogleOauth2', scopes: [] },
        { authorizerType: 'OAuthCredentialProvider', name: 'c', vendor: 'GoogleOauth2' },
        { authorizerType: 'ApiKeyCredentialProvider', name: 'd' },
      ] as never,
    });
    expect(idx.get('a')).toEqual(['x', 'y']);
    expect(idx.has('b')).toBe(false);
    expect(idx.has('c')).toBe(false);
    expect(idx.has('d')).toBe(false);
  });

  it('returns an empty map when there are no credentials', () => {
    expect(buildCredentialScopesIndex({ credentials: [] })).toEqual(new Map());
    expect(buildCredentialScopesIndex({} as never)).toEqual(new Map());
  });
});
