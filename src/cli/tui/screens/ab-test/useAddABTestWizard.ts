import type { VariantConfig } from './VariantConfigForm';
import type { AddABTestConfig, AddABTestStep } from './types';
import { useCallback, useState } from 'react';

const ALL_STEPS: AddABTestStep[] = [
  'name',
  'description',
  'gateway',
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
    gateway: '',
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

export function useAddABTestWizard() {
  const [config, setConfig] = useState<AddABTestConfig>(getDefaultConfig);
  const [step, setStep] = useState<AddABTestStep>('name');

  const currentIndex = ALL_STEPS.indexOf(step);

  const goBack = useCallback(() => {
    const prevStep = ALL_STEPS[currentIndex - 1];
    if (prevStep) setStep(prevStep);
  }, [currentIndex]);

  const nextStep = useCallback((currentStep: AddABTestStep): AddABTestStep | undefined => {
    const idx = ALL_STEPS.indexOf(currentStep);
    return ALL_STEPS[idx + 1];
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

  const setGateway = useCallback(
    (gateway: string) => {
      setConfig(c => ({ ...c, gateway }));
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
    setName,
    setDescription,
    setGateway,
    setVariants,
    setOnlineEval,
    setMaxDuration,
    setEnableOnCreate,
    reset,
  };
}
