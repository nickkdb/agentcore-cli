import { requireProject } from '../../tui/guards';
import { EditConfigBundleFlow } from '../../tui/screens/config-bundle/EditConfigBundleFlow';
import type { Command } from '@commander-js/extra-typings';
import { render } from 'ink';
import React from 'react';

export function registerEdit(program: Command): Command {
  const editCmd = program
    .command('edit')
    .description('Edit AgentCore resources')
    .showHelpAfterError()
    .showSuggestionAfterError();

  // Catch-all argument for invalid subcommands
  editCmd.argument('[subcommand]').action((subcommand: string | undefined, _options, cmd) => {
    if (subcommand) {
      console.error(`error: '${subcommand}' is not a valid subcommand.`);
      cmd.outputHelp();
      process.exit(1);
    }

    requireProject();

    const { clear, unmount } = render(
      <EditConfigBundleFlow
        isInteractive={false}
        onExit={() => {
          clear();
          unmount();
        }}
        onBack={() => {
          clear();
          unmount();
        }}
      />
    );
  });

  return editCmd;
}
