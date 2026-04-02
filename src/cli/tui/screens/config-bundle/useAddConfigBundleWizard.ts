import type { ComponentConfigurationMap } from '../../../../schema';
import type { AddConfigBundleConfig, AddConfigBundleStep, ComponentInputMethod } from './types';
import { useCallback, useState } from 'react';

const ALL_STEPS: AddConfigBundleStep[] = [
  'name',
  'description',
  'inputMethod',
  'components',
  'branchName',
  'commitMessage',
  'confirm',
];

function getDefaultConfig(): AddConfigBundleConfig {
  return {
    name: '',
    description: '',
    inputMethod: 'inline',
    components: {},
    componentsRaw: '',
    branchName: 'main',
    commitMessage: '',
  };
}

export function useAddConfigBundleWizard() {
  const [config, setConfig] = useState<AddConfigBundleConfig>(getDefaultConfig);
  const [step, setStep] = useState<AddConfigBundleStep>('name');

  const currentIndex = ALL_STEPS.indexOf(step);

  const goBack = useCallback(() => {
    const prevStep = ALL_STEPS[currentIndex - 1];
    if (prevStep) setStep(prevStep);
  }, [currentIndex]);

  const nextStep = useCallback((currentStep: AddConfigBundleStep): AddConfigBundleStep | undefined => {
    const idx = ALL_STEPS.indexOf(currentStep);
    return ALL_STEPS[idx + 1];
  }, []);

  const setName = useCallback(
    (name: string) => {
      setConfig(c => ({ ...c, name }));
      const next = nextStep('name');
      if (next) setStep(next);
    },
    [nextStep]
  );

  const setDescription = useCallback(
    (description: string) => {
      setConfig(c => ({ ...c, description }));
      const next = nextStep('description');
      if (next) setStep(next);
    },
    [nextStep]
  );

  const setInputMethod = useCallback(
    (inputMethod: ComponentInputMethod) => {
      setConfig(c => ({ ...c, inputMethod }));
      const next = nextStep('inputMethod');
      if (next) setStep(next);
    },
    [nextStep]
  );

  const setComponents = useCallback(
    (components: ComponentConfigurationMap, raw: string) => {
      setConfig(c => ({ ...c, components, componentsRaw: raw }));
      const next = nextStep('components');
      if (next) setStep(next);
    },
    [nextStep]
  );

  const setBranchName = useCallback(
    (branchName: string) => {
      setConfig(c => ({ ...c, branchName }));
      const next = nextStep('branchName');
      if (next) setStep(next);
    },
    [nextStep]
  );

  const setCommitMessage = useCallback(
    (commitMessage: string) => {
      setConfig(c => ({ ...c, commitMessage }));
      const next = nextStep('commitMessage');
      if (next) setStep(next);
    },
    [nextStep]
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
    setInputMethod,
    setComponents,
    setBranchName,
    setCommitMessage,
    reset,
  };
}
