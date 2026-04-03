import { requireProject } from '../../tui/guards';
import { EditFlow } from '../../tui/screens/edit';
import type { Command } from '@commander-js/extra-typings';
import { render } from 'ink';
import React from 'react';

export function registerEdit(program: Command): Command {
  const editCmd = program
    .command('edit')
    .description('Edit AgentCore resources')
    .showHelpAfterError()
    .showSuggestionAfterError();

  editCmd.action((_options, cmd) => {
    if (cmd.args.length > 0) {
      console.error(`error: '${cmd.args[0]}' is not a valid subcommand.`);
      cmd.outputHelp();
      process.exit(1);
    }

    requireProject();

    const { clear, unmount } = render(
      <EditFlow
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
