import type { AwsDeploymentTarget } from '../../../../../schema';
import { AwsTargetsSchema } from '../../../../../schema';
import {
  AssignTargetsPanel,
  type EnvironmentAssignments,
  buildAwsTargetsConfig,
  buildEnvironmentsSection,
} from '../AssignTargetsPanel';
import { render } from 'ink-testing-library';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flush = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));

const targetA: AwsDeploymentTarget = { name: 'dev-a', account: '111111111111', region: 'us-west-2' };
const targetB: AwsDeploymentTarget = { name: 'dev-b', account: '222222222222', region: 'us-east-1' };
const targetC: AwsDeploymentTarget = { name: 'prod-a', account: '333333333333', region: 'us-east-1' };

describe('AssignTargetsPanel (UI)', () => {
  it('renders header columns for each environment and rows for each target', () => {
    const { lastFrame } = render(
      <AssignTargetsPanel
        targets={[targetA, targetB, targetC]}
        envNames={['dev', 'prod']}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/Assign targets to environments:/);
    expect(frame).toMatch(/dev/);
    expect(frame).toMatch(/prod/);
    expect(frame).toMatch(/dev-a/);
    expect(frame).toMatch(/dev-b/);
    expect(frame).toMatch(/prod-a/);
  });

  it('toggles the cell at the cursor with Space and surfaces it to onConfirm', async () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <AssignTargetsPanel
        targets={[targetA, targetB]}
        envNames={['dev', 'prod']}
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />
    );
    // Cursor starts at (env=dev, target=dev-a). Toggle on.
    stdin.write(' ');
    await flush();
    // ↓ to dev-b, toggle on.
    stdin.write('\u001B[B');
    await flush();
    stdin.write(' ');
    await flush();
    // → to prod, ↑ back to dev-a... easier: from dev-b, → to prod (still at dev-b row), toggle on.
    stdin.write('\u001B[C');
    await flush();
    stdin.write(' ');
    await flush();
    stdin.write('\r');
    await flush();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const result = onConfirm.mock.calls[0]![0] as EnvironmentAssignments;
    expect(Array.from(result.dev ?? [])).toEqual(['dev-a', 'dev-b']);
    expect(Array.from(result.prod ?? [])).toEqual(['dev-b']);
  });

  it('cancels via Esc', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { stdin } = render(
      <AssignTargetsPanel targets={[targetA]} envNames={['dev']} onConfirm={onConfirm} onCancel={onCancel} />
    );
    stdin.write('\u001B');
    await flush();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders an empty-targets fallback message when no targets are defined', () => {
    const { lastFrame } = render(
      <AssignTargetsPanel
        targets={[]}
        envNames={['dev', 'prod']}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(lastFrame() ?? '').toMatch(/No targets defined yet/);
  });

  it('renders a no-environments fallback when envNames is empty', () => {
    const { lastFrame } = render(
      <AssignTargetsPanel targets={[targetA]} envNames={[]} onConfirm={() => undefined} onCancel={() => undefined} />
    );
    expect(lastFrame() ?? '').toMatch(/No environments to assign/);
  });
});

describe('buildEnvironmentsSection (serialization)', () => {
  it('serializes assignments into the schema-shaped environments map', () => {
    const assignments: EnvironmentAssignments = {
      dev: new Set(['dev-a', 'dev-b']),
      prod: new Set(['prod-a']),
    };
    expect(buildEnvironmentsSection(assignments)).toEqual({
      dev: { targets: ['dev-a', 'dev-b'] },
      prod: { targets: ['prod-a'] },
    });
  });

  it('drops environments with zero assigned targets', () => {
    const assignments: EnvironmentAssignments = {
      dev: new Set(['dev-a']),
      empty: new Set(),
    };
    expect(buildEnvironmentsSection(assignments)).toEqual({
      dev: { targets: ['dev-a'] },
    });
  });

  it('returns undefined when every environment is empty', () => {
    const assignments: EnvironmentAssignments = { dev: new Set(), prod: new Set() };
    expect(buildEnvironmentsSection(assignments)).toBeUndefined();
  });
});

describe('buildAwsTargetsConfig (schema-validated)', () => {
  it('produces an object that AwsTargetsSchema accepts (incl. cross-validation)', () => {
    const config = buildAwsTargetsConfig([targetA, targetB, targetC], {
      dev: new Set(['dev-a', 'dev-b']),
      prod: new Set(['prod-a']),
    });
    // buildAwsTargetsConfig internally calls AwsTargetsSchema.parse, so we
    // re-validate here as a sanity check that the returned object is stable.
    const reparsed = AwsTargetsSchema.parse(config);
    expect(reparsed.targets).toHaveLength(3);
    expect(reparsed.environments?.dev?.targets).toEqual(['dev-a', 'dev-b']);
    expect(reparsed.environments?.prod?.targets).toEqual(['prod-a']);
  });

  it('omits the environments field when no env has any targets', () => {
    const config = buildAwsTargetsConfig([targetA], { dev: new Set() });
    expect(config.environments).toBeUndefined();
    expect(() => AwsTargetsSchema.parse(config)).not.toThrow();
  });

  it('throws on cross-validation when an environment references an unknown target', () => {
    expect(() =>
      buildAwsTargetsConfig([targetA], {
        dev: new Set(['dev-a', 'missing-target']),
      })
    ).toThrowError(/unknown target "missing-target"/);
  });

  it('round-trips through aws-targets.json on disk and re-validates with AwsTargetsSchema', async () => {
    const tmpDir = path.join(os.tmpdir(), `assign-targets-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    try {
      const filePath = path.join(tmpDir, 'aws-targets.json');
      const config = buildAwsTargetsConfig([targetA, targetB, targetC], {
        dev: new Set(['dev-a', 'dev-b']),
        prod: new Set(['prod-a']),
      });
      await writeFile(filePath, JSON.stringify(config, null, 2));

      const raw = await readFile(filePath, 'utf8');
      const parsed = AwsTargetsSchema.parse(JSON.parse(raw));
      expect(parsed.targets.map(t => t.name)).toEqual(['dev-a', 'dev-b', 'prod-a']);
      expect(Object.keys(parsed.environments ?? {})).toEqual(['dev', 'prod']);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  // No-op; placeholder for symmetry with other test files.
});
