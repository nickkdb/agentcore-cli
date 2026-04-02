import { ErrorPrompt } from '../../components';
import { useCreateConfigBundle, useExistingConfigBundleNames } from '../../hooks/useCreateConfigBundle';
import { AddSuccessScreen } from '../add/AddSuccessScreen';
import { AddConfigBundleScreen } from './AddConfigBundleScreen';
import type { AddConfigBundleConfig } from './types';
import React, { useCallback, useEffect, useState } from 'react';

type FlowState =
  | { name: 'create-wizard' }
  | { name: 'create-success'; bundleName: string }
  | { name: 'error'; message: string };

interface AddConfigBundleFlowProps {
  isInteractive?: boolean;
  onExit: () => void;
  onBack: () => void;
  onDev?: () => void;
  onDeploy?: () => void;
}

export function AddConfigBundleFlow({
  isInteractive = true,
  onExit,
  onBack,
  onDev,
  onDeploy,
}: AddConfigBundleFlowProps) {
  const { createConfigBundle, reset: resetCreate } = useCreateConfigBundle();
  const { names: existingNames } = useExistingConfigBundleNames();
  const [flow, setFlow] = useState<FlowState>({ name: 'create-wizard' });

  useEffect(() => {
    if (!isInteractive && flow.name === 'create-success') {
      onExit();
    }
  }, [isInteractive, flow.name, onExit]);

  const handleCreateComplete = useCallback(
    (config: AddConfigBundleConfig) => {
      void createConfigBundle({
        name: config.name,
        description: config.description || undefined,
        components: config.components,
        branchName: config.branchName || 'main',
        commitMessage: config.commitMessage || `Create ${config.name}`,
      }).then(result => {
        if (result.ok) {
          setFlow({ name: 'create-success', bundleName: result.bundleName });
          return;
        }
        setFlow({ name: 'error', message: result.error });
      });
    },
    [createConfigBundle]
  );

  if (flow.name === 'create-wizard') {
    return (
      <AddConfigBundleScreen existingBundleNames={existingNames} onComplete={handleCreateComplete} onExit={onBack} />
    );
  }

  if (flow.name === 'create-success') {
    return (
      <AddSuccessScreen
        isInteractive={isInteractive}
        message={`Added configuration bundle: ${flow.bundleName}`}
        detail="Bundle added to project in `agentcore/agentcore.json`. Deploy with `agentcore deploy`."
        onAddAnother={onBack}
        onDev={onDev}
        onDeploy={onDeploy}
        onExit={onExit}
      />
    );
  }

  return (
    <ErrorPrompt
      message="Failed to add configuration bundle"
      detail={flow.message}
      onBack={() => {
        resetCreate();
        setFlow({ name: 'create-wizard' });
      }}
      onExit={onExit}
    />
  );
}
