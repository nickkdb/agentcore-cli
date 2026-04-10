import type { VariantConfig } from './VariantConfigForm';
import type { AddABTestConfig, AddABTestStep, GatewayChoice } from './types';
import { useCallback, useRef, useState } from 'react';

const ALL_STEPS: AddABTestStep[] = [
  'name',
  'description',
  'gateway',
  'agent',
  'variants',
  'onlineEval',
  'maxDuration',
  'enableOnCreate',
  'confirm',
];

function getDefaultConfig(): AddABTestConfig {
  return {
    name: '',
    description: '',
    agent: '',
    gatewayChoice: { type: 'create-new' },
    controlBundle: '',
    controlVersion: '',
    treatmentBundle: '',
    treatmentVersion: '',
    treatmentWeight: 20,
    onlineEval: '',
    maxDuration: undefined,
    enableOnCreate: true,
  };
}

export type StepSkipCheck = (step: AddABTestStep) => boolean;

export function useAddABTestWizard() {
  const [config, setConfig] = useState<AddABTestConfig>(getDefaultConfig);
  const [step, setStep] = useState<AddABTestStep>('name');
  const skipCheckRef = useRef<StepSkipCheck>(() => false);

  const currentIndex = ALL_STEPS.indexOf(step);

  /** Register a callback that returns true for steps that should be skipped. */
  const setSkipCheck = useCallback((check: StepSkipCheck) => {
    skipCheckRef.current = check;
  }, []);

  const goBack = useCallback(() => {
    // Walk backwards, skipping auto-skippable steps
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (!skipCheckRef.current(ALL_STEPS[i]!)) {
        setStep(ALL_STEPS[i]!);
        return;
      }
    }
  }, [currentIndex]);

  const nextStep = useCallback((currentStep: AddABTestStep): AddABTestStep | undefined => {
    const idx = ALL_STEPS.indexOf(currentStep);
    // Walk forwards, skipping auto-skippable steps
    for (let i = idx + 1; i < ALL_STEPS.length; i++) {
      if (!skipCheckRef.current(ALL_STEPS[i]!)) {
        return ALL_STEPS[i]!;
      }
    }
    return undefined;
  }, []);

  const advance = useCallback(
    (from: AddABTestStep) => {
      const next = nextStep(from);
      if (next) setStep(next);
    },
    [nextStep]
  );

  const setName = useCallback(
    (name: string) => {
      setConfig(c => ({ ...c, name }));
      advance('name');
    },
    [advance]
  );

  const setDescription = useCallback(
    (description: string) => {
      setConfig(c => ({ ...c, description }));
      advance('description');
    },
    [advance]
  );

  const setAgent = useCallback(
    (agent: string) => {
      setConfig(c => ({ ...c, agent }));
      advance('agent');
    },
    [advance]
  );

  const setGateway = useCallback(
    (gatewayChoice: GatewayChoice) => {
      setConfig(c => ({ ...c, gatewayChoice }));
      advance('gateway');
    },
    [advance]
  );

  const setVariants = useCallback(
    (variantConfig: VariantConfig) => {
      setConfig(c => ({
        ...c,
        controlBundle: variantConfig.controlBundle,
        controlVersion: variantConfig.controlVersion,
        treatmentBundle: variantConfig.treatmentBundle,
        treatmentVersion: variantConfig.treatmentVersion,
        treatmentWeight: variantConfig.treatmentWeight,
      }));
      advance('variants');
    },
    [advance]
  );

  const setOnlineEval = useCallback(
    (onlineEval: string) => {
      setConfig(c => ({ ...c, onlineEval }));
      advance('onlineEval');
    },
    [advance]
  );

  const setMaxDuration = useCallback(
    (maxDuration: number | undefined) => {
      setConfig(c => ({ ...c, maxDuration }));
      advance('maxDuration');
    },
    [advance]
  );

  const setEnableOnCreate = useCallback(
    (enableOnCreate: boolean) => {
      setConfig(c => ({ ...c, enableOnCreate }));
      advance('enableOnCreate');
    },
    [advance]
  );

  const reset = useCallback(() => {
    setConfig(getDefaultConfig());
    setStep('name');
  }, []);

  return {
    config,
    step,
    steps: ALL_STEPS,
    currentIndex,
    goBack,
    setSkipCheck,
    setName,
    setDescription,
    setAgent,
    setGateway,
    setVariants,
    setOnlineEval,
    setMaxDuration,
    setEnableOnCreate,
    reset,
  };
}
