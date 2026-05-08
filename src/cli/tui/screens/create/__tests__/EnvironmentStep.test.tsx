import { ENVIRONMENT_PRESETS, EnvironmentStep } from '../EnvironmentStep';
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const flush = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));

describe('EnvironmentStep', () => {
  it('exposes the dev / gamma / prod presets', () => {
    expect(ENVIRONMENT_PRESETS).toEqual(['dev', 'gamma', 'prod']);
  });

  it('auto-skips when targetCount <= 1 (single-target setup)', async () => {
    const onSkip = vi.fn();
    const onComplete = vi.fn();
    const { lastFrame } = render(<EnvironmentStep targetCount={1} onSkip={onSkip} onComplete={onComplete} />);
    await flush();
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').toMatch(/Environment setup skipped/);
  });

  it('renders the y/n prompt with No as the default when targetCount > 1', () => {
    const { lastFrame } = render(
      <EnvironmentStep targetCount={3} onSkip={() => undefined} onComplete={() => undefined} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Define deployment environments\?/);
    expect(frame).toMatch(/3 targets/);
    expect(frame).toMatch(/\(y\) Yes/);
    expect(frame).toMatch(/\(n\) No \[default\]/);
  });

  it('skips with onSkip when the user presses "n"', async () => {
    const onSkip = vi.fn();
    const onComplete = vi.fn();
    const { stdin } = render(<EnvironmentStep targetCount={2} onSkip={onSkip} onComplete={onComplete} />);
    stdin.write('n');
    await flush();
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('skips with onSkip when the user presses Enter at the prompt (default)', async () => {
    const onSkip = vi.fn();
    const onComplete = vi.fn();
    const { stdin } = render(<EnvironmentStep targetCount={2} onSkip={onSkip} onComplete={onComplete} />);
    stdin.write('\r');
    await flush();
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('opens the preset selector on "y" and lists dev/gamma/prod plus custom + done', async () => {
    const { stdin, lastFrame } = render(
      <EnvironmentStep targetCount={2} onSkip={() => undefined} onComplete={() => undefined} />
    );
    stdin.write('y');
    await flush();
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Select environments:/);
    expect(frame).toMatch(/\[ \] dev/);
    expect(frame).toMatch(/\[ \] gamma/);
    expect(frame).toMatch(/\[ \] prod/);
    expect(frame).toMatch(/Add custom environment name…/);
    expect(frame).toMatch(/Done/);
  });

  it('toggles a preset on Enter and shows the checkbox state', async () => {
    const { stdin, lastFrame } = render(
      <EnvironmentStep targetCount={2} onSkip={() => undefined} onComplete={() => undefined} />
    );
    stdin.write('y');
    await flush();
    // Cursor starts at "dev" — toggle it on.
    stdin.write('\r');
    await flush();
    expect(lastFrame() ?? '').toMatch(/\[x\] dev/);
  });

  it('completes with selected presets when the user picks Done', async () => {
    const onComplete = vi.fn();
    const { stdin } = render(<EnvironmentStep targetCount={3} onSkip={() => undefined} onComplete={onComplete} />);
    stdin.write('y');
    await flush();
    // Toggle dev (cursor 0).
    stdin.write('\r');
    await flush();
    // Down to gamma, toggle.
    stdin.write('\u001B[B');
    await flush();
    stdin.write('\r');
    await flush();
    // Down to prod, skip toggle. Down to custom, skip. Down to Done.
    stdin.write('\u001B[B');
    await flush();
    stdin.write('\u001B[B');
    await flush();
    stdin.write('\u001B[B');
    await flush();
    stdin.write('\r');
    await flush();
    expect(onComplete).toHaveBeenCalledWith(['dev', 'gamma']);
  });

  it('falls back to onSkip when the user picks Done with no presets toggled', async () => {
    const onSkip = vi.fn();
    const onComplete = vi.fn();
    const { stdin } = render(<EnvironmentStep targetCount={2} onSkip={onSkip} onComplete={onComplete} />);
    stdin.write('y');
    await flush();
    // Move to "Done" (4 down: dev->gamma->prod->custom->done).
    for (let i = 0; i < 4; i++) {
      stdin.write('\u001B[B');
      await flush();
    }
    stdin.write('\r');
    await flush();
    expect(onSkip).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('lets the user enter a custom environment name and includes it in onComplete', async () => {
    const onComplete = vi.fn();
    const { stdin } = render(<EnvironmentStep targetCount={2} onSkip={() => undefined} onComplete={onComplete} />);
    stdin.write('y');
    await flush();
    // Move to "Add custom environment name…" (down 3 times: dev->gamma->prod->custom).
    for (let i = 0; i < 3; i++) {
      stdin.write('\u001B[B');
      await flush();
    }
    stdin.write('\r');
    await flush();
    // Type a valid custom name and confirm.
    for (const ch of 'staging') {
      stdin.write(ch);
      await flush(10);
    }
    stdin.write('\r');
    await flush();
    expect(onComplete).toHaveBeenCalledWith(['staging']);
  });

  it('rejects an invalid custom name and surfaces an error', async () => {
    const onComplete = vi.fn();
    const { stdin, lastFrame } = render(
      <EnvironmentStep targetCount={2} onSkip={() => undefined} onComplete={onComplete} />
    );
    stdin.write('y');
    await flush();
    for (let i = 0; i < 3; i++) {
      stdin.write('\u001B[B');
      await flush();
    }
    stdin.write('\r');
    await flush();
    // Type an invalid name (capital letter) and try to confirm.
    for (const ch of 'Prod') {
      stdin.write(ch);
      await flush(10);
    }
    stdin.write('\r');
    await flush();
    expect(onComplete).not.toHaveBeenCalled();
    expect(lastFrame() ?? '').toMatch(/lowercase letter/);
  });
});
