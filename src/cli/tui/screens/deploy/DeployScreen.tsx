import { ConfigIO } from '../../../../lib';
import type { AgentCoreMcpSpec, AgentCoreProjectSpec } from '../../../../schema';
import { type EnvDeployResult, handleEnvDeploy } from '../../../commands/deploy/actions';
import { formatTargetStatus } from '../../../operations/deploy/gateway-status';
import {
  AwsTargetConfigUI,
  ConfirmPrompt,
  CredentialSourcePrompt,
  DeployStatus,
  DiffSummaryView,
  LogLink,
  type NextStep,
  NextSteps,
  ResourceGraph,
  Screen,
  StepProgress,
  getAwsConfigHelpText,
} from '../../components';
import { BOOTSTRAP, HELP_TEXT } from '../../constants';
import { useAwsTargetConfig } from '../../hooks';
import { InvokeScreen } from '../invoke';
import { EnvironmentPicker } from './EnvironmentPicker';
import { type PreSynthesized, useDeployFlow } from './useDeployFlow';
import { Box, Text, useInput, useStdout } from 'ink';
import React, { useEffect, useMemo, useState } from 'react';

interface DeployScreenProps {
  /** Whether running in interactive TUI mode (from App.tsx) vs CLI mode */
  isInteractive: boolean;
  onExit: () => void;
  autoConfirm?: boolean;
  /** Navigate to another command (interactive mode only) */
  onNavigate?: (command: string) => void;
  /** Skip preflight and use pre-synthesized context (from plan command) */
  preSynthesized?: PreSynthesized;
  /** Run CDK diff instead of deploying */
  diffMode?: boolean;
}

/** Next steps shown after successful deployment */
function getDeployNextSteps(hasAgents: boolean): NextStep[] {
  if (hasAgents) {
    return [
      { command: 'invoke', label: 'Test your agent' },
      { command: 'status', label: 'View deployment status' },
    ];
  }
  return [
    { command: 'add', label: 'Add an agent' },
    { command: 'status', label: 'View deployment status' },
  ];
}

export function DeployScreen({
  isInteractive,
  onExit,
  autoConfirm,
  onNavigate,
  preSynthesized,
  diffMode,
}: DeployScreenProps) {
  const { stdout } = useStdout();
  const awsConfig = useAwsTargetConfig();
  const [showInvoke, setShowInvoke] = useState(false);
  const [showResourceGraph, setShowResourceGraph] = useState(false);
  const [showDiff, setShowDiff] = useState(diffMode ?? false);
  const [mcpSpec, setMcpSpec] = useState<AgentCoreMcpSpec | undefined>();
  const [envChoice, setEnvChoice] = useState<'pending' | 'skipped' | 'running' | 'done'>('pending');
  const [envDeployResult, setEnvDeployResult] = useState<EnvDeployResult | null>(null);
  const [selectedEnvName, setSelectedEnvName] = useState<string | null>(null);
  const [envDeployLog, setEnvDeployLog] = useState<string[]>([]);

  // Load MCP spec for ResourceGraph
  const configIO = useMemo(() => new ConfigIO(), []);

  const {
    phase,
    steps,
    context,
    deployOutput,
    deployMessages,
    diffSummaries,
    numStacksWithChanges,
    deployNotes,
    postDeployWarnings,
    postDeployHasError,
    isDiffLoading,
    requestDiff,
    hasError,
    hasTokenExpiredError,
    hasCredentialsError,
    isComplete,
    hasStartedCfn,
    logFilePath,
    targetStatuses,
    missingCredentials,
    startDeploy,
    confirmTeardown,
    confirmBootstrap,
    skipBootstrap,
    clearTokenExpiredError,
    clearCredentialsError,
    useEnvLocalCredentials,
    useManualCredentials,
    skipCredentials,
  } = useDeployFlow({ preSynthesized, isInteractive, diffMode });
  const allSuccess = !hasError && isComplete;
  const skipPreflight = !!preSynthesized;

  // Extract MCP spec from project when context is available
  useEffect(() => {
    if (!context) return;
    configIO
      .readProjectSpec()
      .then((project: AgentCoreProjectSpec) => {
        if (project.agentCoreGateways?.length) {
          setMcpSpec({
            agentCoreGateways: project.agentCoreGateways,
            mcpRuntimeTools: project.mcpRuntimeTools,
            unassignedTargets: project.unassignedTargets,
          });
        }
      })
      .catch(() => setMcpSpec(undefined));
  }, [context, configIO]);

  // Toggle ResourceGraph with Ctrl+G
  useInput(
    (input, key) => {
      if (input === 'g' && key.ctrl && context) {
        setShowResourceGraph(prev => !prev);
      }
    },
    { isActive: isInteractive && !!context }
  );

  // Toggle CDK diff with Ctrl+D
  useInput(
    (input, key) => {
      if (input === 'd' && key.ctrl && context) {
        setShowDiff(prev => {
          if (!prev) {
            requestDiff(); // Lazy: runs diff on first show
          }
          return !prev;
        });
      }
    },
    { isActive: isInteractive && !diffMode && !!context }
  );

  // Determine whether to show the env picker. Only relevant in interactive mode
  // when the user has not yet made an env / single-target choice and the
  // project has at least one environment defined.
  const hasEnvironments = !!awsConfig.environments && Object.keys(awsConfig.environments).length > 0;
  const showEnvPicker = isInteractive && !skipPreflight && !diffMode && hasEnvironments && envChoice === 'pending';

  // Auto-start deploy when AWS target is configured (or immediately when preSynthesized)
  useEffect(() => {
    if (showEnvPicker) return;
    if (envChoice === 'running' || envChoice === 'done') return;
    if (phase === 'idle' && (skipPreflight || awsConfig.isConfigured)) {
      startDeploy();
    }
  }, [phase, awsConfig.isConfigured, startDeploy, skipPreflight, showEnvPicker, envChoice]);

  // Auto-confirm teardown when autoConfirm is enabled
  useEffect(() => {
    if (autoConfirm && phase === 'teardown-confirm') {
      confirmTeardown();
    }
  }, [autoConfirm, phase, confirmTeardown]);

  // Auto-confirm bootstrap when autoConfirm is enabled
  useEffect(() => {
    if (autoConfirm && phase === 'bootstrap-confirm') {
      confirmBootstrap();
    }
  }, [autoConfirm, phase, confirmBootstrap]);

  // Trigger token-expired recovery flow when deploy fails with token error
  useEffect(() => {
    if (hasTokenExpiredError && awsConfig.phase !== 'token-expired') {
      awsConfig.triggerTokenExpired();
    }
  }, [hasTokenExpiredError, awsConfig]);

  // Trigger credentials recovery flow when deploy fails with credentials error (interactive mode only)
  useEffect(() => {
    if (isInteractive && hasCredentialsError && awsConfig.phase !== 'choice') {
      awsConfig.triggerNoCredentials();
    }
  }, [isInteractive, hasCredentialsError, awsConfig]);

  // Exit in non-interactive mode when there's an error
  useEffect(() => {
    if (!isInteractive && hasError && phase === 'error') {
      onExit();
    }
  }, [isInteractive, hasError, phase, onExit]);

  // Auto-exit in non-interactive mode on success
  useEffect(() => {
    if (!isInteractive && allSuccess) {
      onExit();
    }
  }, [isInteractive, allSuccess, onExit]);

  // Run multi-target deploy after the user picks an env in the TUI picker.
  useEffect(() => {
    if (envChoice !== 'running' || !selectedEnvName) return;
    let cancelled = false;
    void handleEnvDeploy({
      env: selectedEnvName,
      // Honor the outer DeployScreen's autoConfirm prop so teardown deploys
      // are NOT silently approved when the user opens the TUI without -y.
      // Inside handleDeploy this gates the teardown-confirmation prompt.
      autoConfirm: autoConfirm,
      onLog: line => {
        if (cancelled) return;
        // Keep the last 20 lines so long deploys don't grow state unbounded.
        setEnvDeployLog(prev => (prev.length >= 20 ? [...prev.slice(-19), line] : [...prev, line]));
      },
      onProgress: (step, status) => {
        if (cancelled) return;
        const mark = status === 'success' ? '\u2713' : status === 'error' ? '\u2717' : '\u2026';
        setEnvDeployLog(prev => {
          const next = [...prev, `  ${mark} ${step}`];
          return next.length > 20 ? next.slice(-20) : next;
        });
      },
    }).then(result => {
      if (cancelled) return;
      setEnvDeployResult(result);
      setEnvChoice('done');
    });
    return () => {
      cancelled = true;
    };
  }, [envChoice, selectedEnvName, autoConfirm]);

  // Show invoke screen (only in interactive mode when selected from next steps)
  if (showInvoke && isInteractive) {
    return <InvokeScreen isInteractive={true} onExit={onExit} />;
  }

  // Token expired recovery flow - show re-authentication options
  if (awsConfig.phase === 'token-expired') {
    const handleExit = () => {
      clearTokenExpiredError();
      awsConfig.resetFromTokenExpired();
      onExit();
    };

    return (
      <Screen title="AgentCore Deploy" onExit={handleExit} helpText={getAwsConfigHelpText(awsConfig.phase)}>
        <AwsTargetConfigUI config={awsConfig} onExit={handleExit} isActive={true} />
      </Screen>
    );
  }

  // Credentials error recovery flow - show credential setup options (interactive mode)
  if (awsConfig.phase === 'choice' && hasCredentialsError) {
    const handleExit = () => {
      clearCredentialsError();
      awsConfig.resetFromChoice();
      onExit();
    };

    return (
      <Screen title="AgentCore Deploy" onExit={handleExit} helpText={getAwsConfigHelpText(awsConfig.phase)}>
        <StepProgress steps={steps} />
        <Box marginTop={1}>
          <AwsTargetConfigUI config={awsConfig} onExit={handleExit} isActive={true} />
        </Box>
      </Screen>
    );
  }

  const showAwsConfig = !skipPreflight && !awsConfig.isConfigured;

  // Brief transitional phases — render nothing to avoid a header flash before the real UI
  const awsTransitional =
    awsConfig.phase === 'checking' || awsConfig.phase === 'detecting' || awsConfig.phase === 'saving';
  if (showAwsConfig && awsTransitional) {
    return null;
  }

  // Env picker: only when environments are defined and user hasn't yet chosen.
  if (showEnvPicker && awsConfig.environments) {
    return (
      <Screen title="AgentCore Deploy" onExit={onExit}>
        <EnvironmentPicker
          environments={awsConfig.environments}
          isActive={true}
          onSelect={name => {
            setSelectedEnvName(name);
            setEnvChoice('running');
          }}
          onSkip={() => setEnvChoice('skipped')}
        />
      </Screen>
    );
  }

  // Env deploy in flight or completed.
  if (envChoice === 'running' || envChoice === 'done') {
    return (
      <Screen title="AgentCore Deploy" onExit={onExit}>
        <Box flexDirection="column">
          <Text bold>Environment: {selectedEnvName}</Text>
          {envChoice === 'running' && <Text dimColor>Deploying targets…</Text>}
          {envDeployLog.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {envDeployLog.map((line, idx) => (
                <Text key={`log-${idx}`} dimColor>
                  {line}
                </Text>
              ))}
            </Box>
          )}
          {envChoice === 'done' && envDeployResult && (
            <Box flexDirection="column" marginTop={1}>
              <Text color={envDeployResult.success ? 'green' : 'red'}>
                {envDeployResult.success ? '\u2713' : '\u2717'} Environment &quot;{envDeployResult.envName}&quot;{' '}
                {envDeployResult.success ? 'deployed' : 'deploy failed'}
              </Text>
              {envDeployResult.error && <Text color="red">{envDeployResult.error}</Text>}
              {envDeployResult.results.map((r, idx) => (
                <Text key={r.targetName ?? `result-${idx}`}>
                  {r.success ? '\u2713' : '\u2717'} {r.targetName ?? '(unknown target)'}
                  {r.error ? ` — ${r.error}` : ''}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      </Screen>
    );
  }

  // Credentials prompt phase
  if (phase === 'credentials-prompt') {
    return (
      <CredentialSourcePrompt
        missingCredentials={missingCredentials}
        onUseEnvLocal={useEnvLocalCredentials}
        onManualEntry={useManualCredentials}
        onSkip={skipCredentials}
      />
    );
  }

  // Teardown confirmation phase (only shown if not auto-confirming)
  if (phase === 'teardown-confirm' && !autoConfirm) {
    return (
      <ConfirmPrompt
        message="Tear down all deployed resources?"
        detail="This will delete all AWS resources and the CloudFormation stack for this target. This action cannot be undone."
        onConfirm={confirmTeardown}
        onCancel={onExit}
      />
    );
  }

  // Bootstrap confirmation phase (only shown if not auto-confirming)
  if (phase === 'bootstrap-confirm' && !autoConfirm) {
    return (
      <ConfirmPrompt
        message={BOOTSTRAP.TITLE}
        detail={BOOTSTRAP.EXPLAINER}
        onConfirm={confirmBootstrap}
        onCancel={skipBootstrap}
      />
    );
  }

  const targetDisplay = context?.awsTargets.map(t => `${t.region}:${t.account}`).join(', ');

  // Show deploy status box once CloudFormation has started (after asset publishing)
  const showDeployStatus = !diffMode && (hasStartedCfn || isComplete);

  // Filter out "Deploy to AWS" step when deploy status box is showing
  const displaySteps = showDeployStatus ? steps.filter(s => s.label !== 'Deploy to AWS') : steps;

  const headerContent = context && (
    <Box flexDirection="column">
      <Box>
        <Text>Project: </Text>
        <Text color="green">{context.projectSpec.name}</Text>
      </Box>
      {targetDisplay && (
        <Box>
          <Text>Target: </Text>
          <Text color="yellow">{targetDisplay}</Text>
        </Box>
      )}
    </Box>
  );

  // Build help text with toggle hints when context is available
  const baseHelpText = allSuccess && isInteractive ? HELP_TEXT.NAVIGATE_SELECT : HELP_TEXT.EXIT;
  const toggleHints = [
    !diffMode && diffSummaries.length > 0 && `Ctrl+D ${showDiff ? 'hide' : 'show'} diff`,
    `Ctrl+G ${showResourceGraph ? 'hide' : 'show'} resource graph`,
  ]
    .filter(Boolean)
    .join(' · ');
  const helpText = showAwsConfig
    ? (getAwsConfigHelpText(awsConfig.phase) ?? HELP_TEXT.EXIT)
    : context && isInteractive
      ? `${toggleHints} · ${baseHelpText}`
      : baseHelpText;

  const screenTitle = diffMode ? 'AgentCore Diff' : 'AgentCore Deploy';

  // Compute available height for diff view: terminal height minus chrome elements
  // Chrome: ScreenLayout padding (2) + ScreenHeader (3) + Project/Target (2) + StepProgress (~3)
  //       + margins (2) + scroll indicator (1) + "Diff complete" (2) + LogLink (2) + help text (2)
  const terminalRows = stdout?.rows ?? 24;
  const chromeLines = context ? 17 : 10; // more chrome when project info is visible
  const diffMaxHeight = Math.max(6, terminalRows - chromeLines);

  return (
    <Screen
      title={screenTitle}
      onExit={onExit}
      helpText={helpText}
      headerContent={showAwsConfig ? undefined : headerContent}
    >
      {showAwsConfig ? (
        <AwsTargetConfigUI config={awsConfig} onExit={onExit} isActive={true} />
      ) : (
        <>
          <StepProgress steps={displaySteps} />

          {/* Toggleable ResourceGraph view */}
          {showResourceGraph && context && (
            <Box marginTop={1}>
              <ResourceGraph project={context.projectSpec} mcp={mcpSpec} />
            </Box>
          )}

          {/* Show deploy status when deploying or complete */}
          {showDeployStatus && (
            <Box marginTop={1}>
              <DeployStatus
                messages={deployMessages}
                isComplete={isComplete}
                hasError={hasError}
                hasPostDeployError={postDeployHasError}
                postDeployWarnings={postDeployWarnings}
              />
            </Box>
          )}

          {/* Show diff output (diff mode: always; normal mode: Ctrl+D toggle) */}
          {(diffMode === true || showDiff) && isDiffLoading && (
            <Box marginTop={1}>
              <Text dimColor>Loading diff...</Text>
            </Box>
          )}
          {(diffMode === true || showDiff) && diffSummaries.length > 0 && (
            <Box marginTop={1}>
              <DiffSummaryView
                summaries={diffSummaries}
                numStacksWithChanges={numStacksWithChanges}
                isActive={showDiff || diffMode === true}
                maxHeight={diffMaxHeight}
              />
            </Box>
          )}

          {allSuccess && deployOutput && !diffMode && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="green">{deployOutput}</Text>
            </Box>
          )}

          {allSuccess && diffMode && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="green">Diff complete</Text>
            </Box>
          )}

          {allSuccess && postDeployWarnings.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="yellow" bold>
                Post-deploy warnings:
              </Text>
              {postDeployWarnings.map((w, i) => (
                <Text key={i} color="yellow">
                  {'  '}
                  {w}
                </Text>
              ))}
            </Box>
          )}

          {allSuccess && deployNotes.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {deployNotes.map((note, i) => (
                <Text key={i} dimColor>
                  Note: {note}
                </Text>
              ))}
            </Box>
          )}

          {allSuccess && targetStatuses.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Gateway Targets:</Text>
              {targetStatuses.map(t => (
                <Text key={t.name}>
                  {' '}
                  {t.name}: {formatTargetStatus(t.status)}
                </Text>
              ))}
            </Box>
          )}

          {logFilePath && (
            <Box marginTop={1}>
              <LogLink filePath={logFilePath} />
            </Box>
          )}

          {allSuccess && !diffMode && (
            <NextSteps
              steps={getDeployNextSteps((context?.projectSpec.runtimes.length ?? 0) > 0)}
              isInteractive={isInteractive}
              onSelect={step => {
                if (step.command === 'invoke') {
                  setShowInvoke(true);
                } else if (onNavigate) {
                  onNavigate(step.command);
                }
              }}
              onBack={onExit}
              isActive={allSuccess && !showInvoke}
            />
          )}
        </>
      )}
    </Screen>
  );
}
