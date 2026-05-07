import { requireTTY } from '../tty.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('requireTTY', () => {
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Throw from process.exit so we can assert without actually exiting the test runner.
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code}`);
    }) as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow output during tests */
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('exits 1 with an interactive-terminal message when stdin is not a TTY', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    expect(() => requireTTY()).toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const msg = String(errorSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).toMatch(/requires an interactive terminal/);
  });

  it('exits 1 with an interactive-terminal message when stdout is not a TTY', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    expect(() => requireTTY()).toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const msg = String(errorSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).toMatch(/requires an interactive terminal/);
  });

  it('exits 1 when both stdin and stdout are non-TTY', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    expect(() => requireTTY()).toThrow(/__exit__:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('is a no-op when both stdin and stdout are TTYs', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    expect(() => requireTTY()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
