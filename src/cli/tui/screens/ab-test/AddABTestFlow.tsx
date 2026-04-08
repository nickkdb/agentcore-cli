import { ConfigIO } from '../../../../lib';
import { listConfigurationBundleVersions } from '../../../aws/agentcore-config-bundles';
import { ErrorPrompt } from '../../components';
import { useCreateABTest, useExistingABTestNames } from '../../hooks/useCreateABTest';
import { AddSuccessScreen } from '../add/AddSuccessScreen';
import { AddABTestScreen } from './AddABTestScreen';
import type { AddABTestConfig } from './types';
import React, { useCallback, useEffect, useState } from 'react';

type FlowState =
  | { name: 'create-wizard' }
  | { name: 'create-success'; testName: string }
  | { name: 'error'; message: string };

interface AddABTestFlowProps {
  isInteractive?: boolean;
  onExit: () => void;
  onBack: () => void;
  onDev?: () => void;
  onDeploy?: () => void;
}

export function AddABTestFlow({ isInteractive = true, onExit, onBack, onDev, onDeploy }: AddABTestFlowProps) {
  const { createABTest, reset: resetCreate } = useCreateABTest();
  const { names: existingNames } = useExistingABTestNames();
  const [flow, setFlow] = useState<FlowState>({ name: 'create-wizard' });

  // Load deployed state for bundle lists
  const [deployedBundles, setDeployedBundles] = useState<{ name: string; bundleId: string }[]>([]);
  const [onlineEvalConfigs, setOnlineEvalConfigs] = useState<string[]>([]);
  const [region, setRegion] = useState('us-east-1');

  useEffect(() => {
    const load = async () => {
      try {
        const configIO = new ConfigIO();
        const deployedState = await configIO.readDeployedState();
        const projectSpec = await configIO.readProjectSpec();

        // Get region from first target
        for (const [, target] of Object.entries(deployedState.targets ?? {})) {
          const resources = target.resources;

          // Deployed config bundles
          const bundles = resources?.configBundles;
          if (bundles) {
            setDeployedBundles(
              Object.entries(bundles).map(([name, state]) => ({
                name,
                bundleId: state.bundleId,
              }))
            );
          }
          break;
        }

        // Online eval configs from project spec
        const evalConfigs = projectSpec.onlineEvalConfigs ?? [];
        setOnlineEvalConfigs(evalConfigs.map(c => c.name));

        // Region from env
        setRegion(process.env.AWS_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1');
      } catch {
        // No deployed state — lists will be empty
      }
    };

    void load();
  }, []);

  const fetchBundleVersions = useCallback(
    async (bundleId: string) => {
      try {
        const result = await listConfigurationBundleVersions({ region, bundleId });
        return result.versions.map(v => ({
          versionId: v.versionId,
          createdAt: v.versionCreatedAt,
        }));
      } catch {
        return [];
      }
    },
    [region]
  );

  useEffect(() => {
    if (!isInteractive && flow.name === 'create-success') {
      onExit();
    }
  }, [isInteractive, flow.name, onExit]);

  const handleCreateComplete = useCallback(
    (config: AddABTestConfig) => {
      const controlWeight = 100 - config.treatmentWeight;
      void createABTest({
        name: config.name,
        description: config.description || undefined,
        gateway: config.gateway,
        controlBundle: config.controlBundle,
        controlVersion: config.controlVersion,
        treatmentBundle: config.treatmentBundle,
        treatmentVersion: config.treatmentVersion,
        controlWeight,
        treatmentWeight: config.treatmentWeight,
        onlineEval: config.onlineEval,
        maxDuration: config.maxDuration,
        enableOnCreate: config.enableOnCreate,
      }).then(result => {
        if (result.ok) {
          setFlow({ name: 'create-success', testName: result.testName });
          return;
        }
        setFlow({ name: 'error', message: result.error });
      });
    },
    [createABTest]
  );

  if (flow.name === 'create-wizard') {
    return (
      <AddABTestScreen
        existingTestNames={existingNames}
        deployedBundles={deployedBundles}
        onlineEvalConfigs={onlineEvalConfigs}
        fetchBundleVersions={fetchBundleVersions}
        onComplete={handleCreateComplete}
        onExit={onBack}
      />
    );
  }

  if (flow.name === 'create-success') {
    return (
      <AddSuccessScreen
        isInteractive={isInteractive}
        message={`Added AB test: ${flow.testName}`}
        detail="AB test added to project in `agentcore/agentcore.json`. Deploy with `agentcore deploy` to create."
        onAddAnother={onBack}
        onDev={onDev}
        onDeploy={onDeploy}
        onExit={onExit}
      />
    );
  }

  return (
    <ErrorPrompt
      message="Failed to add AB test"
      detail={flow.message}
      onBack={() => {
        resetCreate();
        setFlow({ name: 'create-wizard' });
      }}
      onExit={onExit}
    />
  );
}
