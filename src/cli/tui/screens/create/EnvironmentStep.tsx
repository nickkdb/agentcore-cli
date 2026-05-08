import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

const ENV_NAME_REGEX = /^[a-z][a-z0-9-]*$/;

export const ENVIRONMENT_PRESETS = ['dev', 'gamma', 'prod'] as const;
export type EnvironmentPreset = (typeof ENVIRONMENT_PRESETS)[number];

export interface EnvironmentStepProps {
  /** Number of targets the user has defined. The step is a no-op when <= 1. */
  targetCount: number;
  /** Called with the chosen environment names (preset values or custom name). */
  onComplete: (envNames: string[]) => void;
  /** Called when the user skips this step (default). */
  onSkip: () => void;
  isActive?: boolean;
}

type Mode = 'prompt' | 'preset-select' | 'custom-name';

interface SelectionState {
  presetsSelected: Record<EnvironmentPreset, boolean>;
  customName: string;
  customError: string | null;
}

const initialSelection: SelectionState = {
  presetsSelected: { dev: false, gamma: false, prod: false },
  customName: '',
  customError: null,
};

/**
 * Optional create-wizard step: lets the user define one or more deployment
 * environments (dev / gamma / prod or a custom name) when more than one
 * target has been configured. The step defaults to "No" so users with a
 * single-target setup or who don't need environments can skip with one keypress.
 *
 * T13: this component implements the UI only. T14 wires the chosen env names
 * into the write path (`environments` section of aws-targets.json) and adds
 * the per-target assignment panel.
 */
export function EnvironmentStep({ targetCount, onComplete, onSkip, isActive = true }: EnvironmentStepProps) {
  const eligible = targetCount > 1;
  const [mode, setMode] = useState<Mode>('prompt');
  const [cursor, setCursor] = useState(0);
  const [selection, setSelection] = useState<SelectionState>(initialSelection);

  // Auto-skip when the step is not eligible. Surfaces as a no-op for the parent.
  React.useEffect(() => {
    if (!eligible && isActive) onSkip();
  }, [eligible, isActive, onSkip]);

  const presetItems: { id: EnvironmentPreset | '__custom__' | '__done__'; label: string }[] = [
    ...ENVIRONMENT_PRESETS.map(name => ({
      id: name,
      label: `${selection.presetsSelected[name] ? '[x]' : '[ ]'} ${name}`,
    })),
    { id: '__custom__', label: 'Add custom environment name…' },
    { id: '__done__', label: 'Done' },
  ];

  useInput(
    (input, key) => {
      if (!eligible) return;

      if (mode === 'prompt') {
        if (input === 'y' || input === 'Y') {
          setMode('preset-select');
          setCursor(0);
        } else if (input === 'n' || input === 'N' || key.escape || key.return) {
          onSkip();
        }
        return;
      }

      if (mode === 'preset-select') {
        if (key.upArrow) {
          setCursor(c => (c - 1 + presetItems.length) % presetItems.length);
        } else if (key.downArrow) {
          setCursor(c => (c + 1) % presetItems.length);
        } else if (key.escape) {
          setMode('prompt');
        } else if (key.return) {
          const choice = presetItems[cursor]!;
          if (choice.id === '__custom__') {
            setMode('custom-name');
            setSelection(s => ({ ...s, customError: null }));
          } else if (choice.id === '__done__') {
            const chosen = ENVIRONMENT_PRESETS.filter(name => selection.presetsSelected[name]);
            if (chosen.length === 0) {
              onSkip();
            } else {
              onComplete(chosen);
            }
          } else {
            // Toggle preset
            const presetId = choice.id;
            setSelection(s => ({
              ...s,
              presetsSelected: { ...s.presetsSelected, [presetId]: !s.presetsSelected[presetId] },
            }));
          }
        }
        return;
      }

      if (mode === 'custom-name') {
        if (key.escape) {
          setMode('preset-select');
          setSelection(s => ({ ...s, customName: '', customError: null }));
        } else if (key.return) {
          const trimmed = selection.customName.trim();
          if (!ENV_NAME_REGEX.test(trimmed)) {
            setSelection(s => ({
              ...s,
              customError:
                'Environment name must start with a lowercase letter and contain only lowercase alphanumeric characters and hyphens.',
            }));
            return;
          }
          const chosen = ENVIRONMENT_PRESETS.filter(name => selection.presetsSelected[name]);
          onComplete([...chosen, trimmed]);
        } else if (key.backspace || key.delete) {
          setSelection(s => ({ ...s, customName: s.customName.slice(0, -1), customError: null }));
        } else if (input && !key.ctrl && !key.meta) {
          setSelection(s => ({ ...s, customName: s.customName + input, customError: null }));
        }
      }
    },
    { isActive }
  );

  if (!eligible) {
    return (
      <Box flexDirection="column">
        <Text dimColor>(Environment setup skipped: only one target defined.)</Text>
      </Box>
    );
  }

  if (mode === 'prompt') {
    return (
      <Box flexDirection="column">
        <Text bold>Define deployment environments?</Text>
        <Text dimColor>
          Group your {targetCount} targets into environments (e.g. dev / gamma / prod) so you can run{' '}
          <Text>agentcore deploy --env &lt;name&gt;</Text> to deploy them as a set.
        </Text>
        <Box marginTop={1}>
          <Text>(y) Yes · (n) No [default]</Text>
        </Box>
      </Box>
    );
  }

  if (mode === 'preset-select') {
    return (
      <Box flexDirection="column">
        <Text bold>Select environments:</Text>
        {presetItems.map((item, idx) => {
          const isCursor = idx === cursor;
          return (
            <Text key={item.id} color={isCursor ? 'cyan' : undefined}>
              {isCursor ? '> ' : '  '}
              {item.label}
            </Text>
          );
        })}
        <Box marginTop={1}>
          <Text dimColor>↑/↓ to navigate · Enter to toggle/select · Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  // custom-name
  return (
    <Box flexDirection="column">
      <Text bold>Custom environment name:</Text>
      <Text>
        {'> '}
        {selection.customName}
        <Text inverse> </Text>
      </Text>
      {selection.customError && <Text color="red">{selection.customError}</Text>}
      <Box marginTop={1}>
        <Text dimColor>Enter to confirm · Esc to go back · format: lowercase, hyphens, digits</Text>
      </Box>
    </Box>
  );
}
