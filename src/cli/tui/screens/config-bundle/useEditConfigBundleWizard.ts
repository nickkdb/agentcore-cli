import type { ComponentConfigurationMap } from '../../../../schema';
import type { ComponentInputMethod } from './types';
import { useCallback, useState } from 'react';

export type EditConfigBundleStep =
  | 'selectBundle'
  | 'inputMethod'
  | 'components'
  | 'commitMessage'
  | 'branchName'
  | 'confirm';

const ALL_STEPS: EditConfigBundleStep[] = [
  'selectBundle',
  'inputMethod',
  'components',
  'commitMessage',
  'branchName',
  'confirm',
];

export const EDIT_STEP_LABELS: Record<EditConfigBundleStep, string> = {
  selectBundle: 'Bundle',
  inputMethod: 'Input',
  components: 'Components',
  commitMessage: 'Message',
  branchName: 'Branch',
  confirm: 'Confirm',
};

export interface EditConfigBundleConfig {
  bundleName: string;
  inputMethod: ComponentInputMethod;
  components: ComponentConfigurationMap;
  componentsRaw: string;
  commitMessage: string;
  branchName: string;
}

function getDefaultConfig(): EditConfigBundleConfig {
  return {
    bundleName: '',
    inputMethod: 'inline',
    components: {},
    componentsRaw: '',
    commitMessage: '',
    branchName: '',
  };
}

export function useEditConfigBundleWizard() {
  const [config, setConfig] = useState<EditConfigBundleConfig>(getDefaultConfig);
  const [step, setStep] = useState<EditConfigBundleStep>('selectBundle');

  const currentIndex = ALL_STEPS.indexOf(step);

  const goBack = useCallback(() => {
    const prevStep = ALL_STEPS[currentIndex - 1];
    if (prevStep) setStep(prevStep);
  }, [currentIndex]);

  const nextStep = useCallback((currentStep: EditConfigBundleStep): EditConfigBundleStep | undefined => {
    const idx = ALL_STEPS.indexOf(currentStep);
    return ALL_STEPS[idx + 1];
  }, []);

  const selectBundle = useCallback(
    (bundleName: string) => {
      setConfig(c => ({ ...c, bundleName }));
      const next = nextStep('selectBundle');
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

  const setCommitMessage = useCallback(
    (commitMessage: string) => {
      setConfig(c => ({ ...c, commitMessage }));
      const next = nextStep('commitMessage');
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

  const reset = useCallback(() => {
    setConfig(getDefaultConfig());
    setStep('selectBundle');
  }, []);

  return {
    config,
    step,
    steps: ALL_STEPS,
    currentIndex,
    goBack,
    selectBundle,
    setInputMethod,
    setComponents,
    setCommitMessage,
    setBranchName,
    reset,
  };
}
