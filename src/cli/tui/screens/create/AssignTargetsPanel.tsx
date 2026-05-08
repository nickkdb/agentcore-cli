import type { AwsDeploymentTarget, Environments } from '../../../../schema';
import { AwsTargetsSchema } from '../../../../schema';
import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

/** Assignment matrix: environment name → set of selected target names. */
export type EnvironmentAssignments = Record<string, Set<string>>;

export interface AssignTargetsPanelProps {
  targets: AwsDeploymentTarget[];
  envNames: string[];
  /** Optional initial assignments (defaults to empty for every env). */
  initial?: EnvironmentAssignments;
  /** Called with the final assignments when the user confirms. */
  onConfirm: (assignments: EnvironmentAssignments) => void;
  /** Called when the user backs out of this step. */
  onCancel: () => void;
  isActive?: boolean;
}

/**
 * Interactive panel: cursor moves through an env-major / target-minor grid.
 * Space toggles the cell. Enter confirms. Esc cancels. The panel never writes
 * to disk; the parent wires the resulting matrix into aws-targets.json.
 */
export function AssignTargetsPanel({
  targets,
  envNames,
  initial,
  onConfirm,
  onCancel,
  isActive = true,
}: AssignTargetsPanelProps) {
  const [assignments, setAssignments] = useState<EnvironmentAssignments>(() => {
    const seed: EnvironmentAssignments = {};
    for (const env of envNames) {
      seed[env] = new Set(initial?.[env] ?? []);
    }
    return seed;
  });
  const [envCursor, setEnvCursor] = useState(0);
  const [targetCursor, setTargetCursor] = useState(0);

  const noEnvs = envNames.length === 0;
  const noTargets = targets.length === 0;

  useInput(
    (input, key) => {
      if (noEnvs || noTargets) {
        if (key.return || key.escape) onCancel();
        return;
      }
      if (key.upArrow) {
        setTargetCursor(c => (c - 1 + targets.length) % targets.length);
      } else if (key.downArrow) {
        setTargetCursor(c => (c + 1) % targets.length);
      } else if (key.leftArrow) {
        setEnvCursor(c => (c - 1 + envNames.length) % envNames.length);
      } else if (key.rightArrow) {
        setEnvCursor(c => (c + 1) % envNames.length);
      } else if (input === ' ' || input === 'x' || input === 'X') {
        const env = envNames[envCursor]!;
        const target = targets[targetCursor]!;
        setAssignments(prev => {
          const next = { ...prev };
          const current = new Set(next[env] ?? []);
          if (current.has(target.name)) current.delete(target.name);
          else current.add(target.name);
          next[env] = current;
          return next;
        });
      } else if (key.return) {
        onConfirm(assignments);
      } else if (key.escape) {
        onCancel();
      }
    },
    { isActive }
  );

  if (noEnvs) {
    return (
      <Box flexDirection="column">
        <Text dimColor>(No environments to assign — skipping target assignment.)</Text>
        <Text dimColor>Press Enter to continue.</Text>
      </Box>
    );
  }
  if (noTargets) {
    return (
      <Box flexDirection="column">
        <Text dimColor>(No targets defined yet — environments will be created without target assignments.)</Text>
        <Text dimColor>Add targets later via aws-targets.json. Press Enter to continue.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Assign targets to environments:</Text>
      <Box flexDirection="row" marginTop={1}>
        <Box width={20} flexDirection="column">
          <Text bold>Target \\ Env</Text>
          {targets.map((t, idx) => (
            <Text key={t.name} color={idx === targetCursor ? 'cyan' : undefined}>
              {idx === targetCursor ? '> ' : '  '}
              {t.name}
            </Text>
          ))}
        </Box>
        {envNames.map((env, envIdx) => {
          const assigned = assignments[env] ?? new Set<string>();
          return (
            <Box key={env} width={12} flexDirection="column">
              <Text bold color={envIdx === envCursor ? 'cyan' : undefined}>
                {env}
              </Text>
              {targets.map((t, tIdx) => {
                const isCursor = envIdx === envCursor && tIdx === targetCursor;
                const checked = assigned.has(t.name);
                return (
                  <Text key={t.name} color={isCursor ? 'cyan' : undefined}>
                    {isCursor ? '> ' : '  '}
                    {checked ? '[x]' : '[ ]'}
                  </Text>
                );
              })}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ row · ←/→ env · Space toggle · Enter confirm · Esc cancel</Text>
      </Box>
    </Box>
  );
}

/**
 * Build the `environments` section of aws-targets.json from an assignment
 * matrix. Drops environments with zero targets so the resulting object always
 * passes EnvironmentSchema's `min(1)` rule. Returns `undefined` when no
 * environment ends up with any targets — that signals the caller should omit
 * the `environments` field entirely.
 */
export function buildEnvironmentsSection(assignments: EnvironmentAssignments): Environments | undefined {
  const result: Environments = {};
  for (const [name, members] of Object.entries(assignments)) {
    const targets = Array.from(members).filter(Boolean);
    if (targets.length === 0) continue;
    result[name] = { targets };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Build a complete AwsTargets payload (object form) from a target list and an
 * assignment matrix, validated against AwsTargetsSchema (incl. cross-validation
 * that every environment target ref exists in `targets[]`). Throws ZodError
 * when invalid.
 */
export function buildAwsTargetsConfig(
  targets: AwsDeploymentTarget[],
  assignments: EnvironmentAssignments
): { targets: AwsDeploymentTarget[]; environments?: Environments } {
  const environments = buildEnvironmentsSection(assignments);
  const candidate = { targets, ...(environments ? { environments } : {}) };
  // Run the schema (incl. superRefine) so callers get a guaranteed-valid object.
  return AwsTargetsSchema.parse(candidate);
}
