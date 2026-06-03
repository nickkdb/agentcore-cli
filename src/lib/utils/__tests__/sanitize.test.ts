import { sanitizeForTerminal, sanitizeLongFieldForTerminal } from '../sanitize';
import { describe, expect, it } from 'vitest';

describe('sanitizeForTerminal', () => {
  it('strips ANSI control characters (0x00-0x1f and 0x7f)', () => {
    const dangerous = `clean\x1b[31mred\x07bel\x00null\x7fdel`;
    expect(sanitizeForTerminal(dangerous)).toBe('clean[31mredbelnulldel');
  });

  it('preserves printable ASCII', () => {
    expect(sanitizeForTerminal('hello world 123 !@#')).toBe('hello world 123 !@#');
  });

  it('preserves UTF-8 multi-byte characters above 0x7f', () => {
    expect(sanitizeForTerminal('héllo 世界 🌍')).toBe('héllo 世界 🌍');
  });

  it('caps to default 200 chars', () => {
    expect(sanitizeForTerminal('x'.repeat(500))).toHaveLength(200);
  });

  it('respects a custom max length', () => {
    expect(sanitizeForTerminal('x'.repeat(50), 10)).toBe('xxxxxxxxxx');
  });

  it('extracts message from Error instances', () => {
    expect(sanitizeForTerminal(new Error('boom\x1b[2J'))).toBe('boom[2J');
  });

  it('handles undefined and null gracefully', () => {
    expect(sanitizeForTerminal(undefined)).toBe('');
    expect(sanitizeForTerminal(null)).toBe('');
  });
});

describe('sanitizeLongFieldForTerminal', () => {
  it('caps at 8192 instead of 200', () => {
    const big = 'a'.repeat(10_000);
    expect(sanitizeLongFieldForTerminal(big)).toHaveLength(8192);
  });

  it('still strips control characters', () => {
    const url = `https://idp.example.com/oauth/authorize?state=\x00abc`;
    expect(sanitizeLongFieldForTerminal(url)).toBe('https://idp.example.com/oauth/authorize?state=abc');
  });
});
