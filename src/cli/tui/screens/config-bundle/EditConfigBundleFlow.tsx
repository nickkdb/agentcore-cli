import { ErrorPrompt } from '../../components';
import { useExistingConfigBundleNames } from '../../hooks/useCreateConfigBundle';
import { useEditConfigBundle } from '../../hooks/useEditConfigBundle';
import { AddSuccessScreen } from '../add/AddSuccessScreen';
import { EditConfigBundleScreen } from './EditConfigBundleScreen';
import type { EditConfigBundleConfig } from './useEditConfigBundleWizard';
import React, { useCallback, useEffect, useState } from 'react';

type FlowState =
  | { name: 'edit-wizard' }
  | { name: 'edit-success'; bundleName: string }
  | { name: 'error'; message: string };

interface EditConfigBundleFlowProps {
  isInteractive?: boolean;
  onExit: () => void;
  onBack: () => void;
  onDev?: () => void;
  onDeploy?: () => void;
}

export function EditConfigBundleFlow({
  isInteractive = true,
  onExit,
  onBack,
  onDev,
  onDeploy,
}: EditConfigBundleFlowProps) {
  const { editConfigBundle, reset: resetEdit } = useEditConfigBundle();
  const { names: bundleNames } = useExistingConfigBundleNames();
  const [flow, setFlow] = useState<FlowState>({ name: 'edit-wizard' });

  useEffect(() => {
    if (!isInteractive && flow.name === 'edit-success') {
      onExit();
    }
  }, [isInteractive, flow.name, onExit]);

  const handleEditComplete = useCallback(
    (config: EditConfigBundleConfig) => {
      void editConfigBundle({
        bundleName: config.bundleName,
        components: config.components,
        branchName: config.branchName || undefined,
        commitMessage: config.commitMessage || undefined,
      }).then(result => {
        if (result.ok) {
          setFlow({ name: 'edit-success', bundleName: result.bundleName });
          return;
        }
        setFlow({ name: 'error', message: result.error });
      });
    },
    [editConfigBundle]
  );

  if (flow.name === 'edit-wizard') {
    if (bundleNames.length === 0) {
      return (
        <ErrorPrompt
          message="No configuration bundles found"
          detail="Add a configuration bundle first with `agentcore add config-bundle`."
          onBack={onBack}
          onExit={onExit}
        />
      );
    }

    return <EditConfigBundleScreen bundleNames={bundleNames} onComplete={handleEditComplete} onExit={onBack} />;
  }

  if (flow.name === 'edit-success') {
    return (
      <AddSuccessScreen
        isInteractive={isInteractive}
        message={`Updated configuration bundle: ${flow.bundleName}`}
        detail="Bundle updated in `agentcore/agentcore.json`. Deploy with `agentcore deploy` to push the new version."
        onAddAnother={onBack}
        onDev={onDev}
        onDeploy={onDeploy}
        onExit={onExit}
      />
    );
  }

  return (
    <ErrorPrompt
      message="Failed to edit configuration bundle"
      detail={flow.message}
      onBack={() => {
        resetEdit();
        setFlow({ name: 'edit-wizard' });
      }}
      onExit={onExit}
    />
  );
}
