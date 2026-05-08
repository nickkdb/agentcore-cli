import type { Environments } from '../../../../../schema';
import { EnvironmentPicker } from '../EnvironmentPicker';
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const environments: Environments = {
  dev: { targets: ['dev-a', 'dev-b'] },
  prod: { targets: ['prod-a'], overrides: { envVars: { LOG_LEVEL: 'INFO' } } },
};

describe('EnvironmentPicker', () => {
  it('renders one entry per environment plus a skip option', () => {
    const { lastFrame } = render(
      <EnvironmentPicker environments={environments} onSelect={() => undefined} onSkip={() => undefined} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Select an environment to deploy:/);
    expect(frame).toMatch(/dev/);
    expect(frame).toMatch(/prod/);
    expect(frame).toMatch(/2 targets: dev-a, dev-b/);
    expect(frame).toMatch(/1 target: prod-a/);
    expect(frame).toMatch(/Deploy single target \(skip environment\)/);
  });

  it('calls onSelect with the chosen environment when Enter is pressed', () => {
    const onSelect = vi.fn();
    const onSkip = vi.fn();
    const { stdin } = render(<EnvironmentPicker environments={environments} onSelect={onSelect} onSkip={onSkip} />);
    // First entry is "dev" (alphabetical). Press Enter immediately.
    stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith('dev');
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('navigates with arrow keys and selects the highlighted env', () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <EnvironmentPicker environments={environments} onSelect={onSelect} onSkip={() => undefined} />
    );
    // Down once -> "prod" (alphabetical: dev, prod, skip).
    stdin.write('\u001B[B');
    stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith('prod');
  });

  it('calls onSkip when the skip option is selected with Enter', () => {
    const onSkip = vi.fn();
    const { stdin } = render(
      <EnvironmentPicker environments={environments} onSelect={() => undefined} onSkip={onSkip} />
    );
    // Down twice from "dev" -> "prod" -> skip.
    stdin.write('\u001B[B');
    stdin.write('\u001B[B');
    stdin.write('\r');
    expect(onSkip).toHaveBeenCalled();
  });

  it('calls onSkip when the user presses "s"', () => {
    const onSkip = vi.fn();
    const onSelect = vi.fn();
    const { stdin } = render(<EnvironmentPicker environments={environments} onSelect={onSelect} onSkip={onSkip} />);
    stdin.write('s');
    expect(onSkip).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders no env entries when the environments map is empty (escape hatch only)', () => {
    const { lastFrame } = render(
      <EnvironmentPicker environments={{}} onSelect={() => undefined} onSkip={() => undefined} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Deploy single target \(skip environment\)/);
    expect(frame).not.toMatch(/dev/);
    expect(frame).not.toMatch(/prod/);
  });
});
