import type { Environments } from '../../../../schema';
import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

export interface EnvironmentPickerProps {
  environments: Environments;
  /** Called with the chosen environment name. */
  onSelect: (envName: string) => void;
  /** Skip the picker and proceed to the standard single-target deploy. */
  onSkip: () => void;
  isActive?: boolean;
}

const SKIP_OPTION = '__skip__';

/**
 * Pre-deploy environment picker. Lists the environments parsed from
 * aws-targets.json plus a "Deploy single target" escape hatch. Arrow keys
 * navigate, Enter selects, `s` skips.
 */
export function EnvironmentPicker({ environments, onSelect, onSkip, isActive = true }: EnvironmentPickerProps) {
  const envNames = Object.keys(environments).sort();
  const items: { id: string; label: string; detail?: string }[] = envNames.map(name => {
    const targets = environments[name]?.targets ?? [];
    return {
      id: name,
      label: name,
      detail: `${targets.length} target${targets.length === 1 ? '' : 's'}: ${targets.join(', ')}`,
    };
  });
  items.push({ id: SKIP_OPTION, label: 'Deploy single target (skip environment)', detail: undefined });

  const [cursor, setCursor] = useState(0);

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setCursor(c => (c - 1 + items.length) % items.length);
      } else if (key.downArrow) {
        setCursor(c => (c + 1) % items.length);
      } else if (key.return) {
        const choice = items[cursor]!;
        if (choice.id === SKIP_OPTION) {
          onSkip();
        } else {
          onSelect(choice.id);
        }
      } else if (input === 's' || input === 'S') {
        onSkip();
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column">
      <Text bold>Select an environment to deploy:</Text>
      {items.map((item, idx) => {
        const isCursor = idx === cursor;
        return (
          <Box key={item.id} flexDirection="row">
            <Text color={isCursor ? 'cyan' : undefined}>{isCursor ? '> ' : '  '}</Text>
            <Box flexDirection="column">
              <Text color={isCursor ? 'cyan' : undefined} bold={isCursor}>
                {item.label}
              </Text>
              {item.detail && <Text dimColor>{`    ${item.detail}`}</Text>}
            </Box>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ to navigate · Enter to select · s to skip</Text>
      </Box>
    </Box>
  );
}
