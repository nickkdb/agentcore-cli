import { ABTestNameSchema } from '../../../../schema/schemas/primitives/ab-test';
import type { SelectableItem } from '../../components';
import { ConfirmReview, Panel, Screen, StepIndicator, TextInput, WizardSelect } from '../../components';
import { HELP_TEXT } from '../../constants';
import { useListNavigation } from '../../hooks';
import type { VersionLoadState } from './VariantConfigForm';
import { VariantConfigForm } from './VariantConfigForm';
import type { AddABTestConfig } from './types';
import { AB_TEST_STEP_LABELS } from './types';
import { useAddABTestWizard } from './useAddABTestWizard';
import React, { useMemo } from 'react';

interface AddABTestScreenProps {
  onComplete: (config: AddABTestConfig) => void;
  onExit: () => void;
  existingTestNames: string[];
  deployedBundles: { name: string; bundleId: string }[];
  onlineEvalConfigs: string[];
  fetchBundleVersions: (bundleId: string) => Promise<{ versionId: string; createdAt: string }[]>;
}

export function AddABTestScreen({
  onComplete,
  onExit,
  existingTestNames,
  deployedBundles,
  onlineEvalConfigs,
  fetchBundleVersions,
}: AddABTestScreenProps) {
  const wizard = useAddABTestWizard();

  // Build select items
  const bundleItems: SelectableItem[] = useMemo(
    () => deployedBundles.map(b => ({ id: b.name, title: b.name, description: `ID: ${b.bundleId}` })),
    [deployedBundles]
  );

  const onlineEvalItems: SelectableItem[] = useMemo(
    () => onlineEvalConfigs.map(name => ({ id: name, title: name, description: 'Online Eval Config' })),
    [onlineEvalConfigs]
  );

  const enableItems: SelectableItem[] = useMemo(
    () => [
      { id: 'yes', title: 'Yes', description: 'Start the AB test immediately after deploy' },
      { id: 'no', title: 'No', description: 'Create paused — start manually later' },
    ],
    []
  );

  // Version items — fetched dynamically per bundle
  const [controlVersionItems, setControlVersionItems] = React.useState<SelectableItem[]>([]);
  const [treatmentVersionItems, setTreatmentVersionItems] = React.useState<SelectableItem[]>([]);
  const [controlVersionLoadState, setControlVersionLoadState] = React.useState<VersionLoadState>('idle');
  const [treatmentVersionLoadState, setTreatmentVersionLoadState] = React.useState<VersionLoadState>('idle');

  const handleFetchVersions = React.useCallback(
    (bundleName: string) => {
      const bundle = deployedBundles.find(b => b.name === bundleName);
      if (!bundle) return;

      setControlVersionLoadState('loading');
      setTreatmentVersionLoadState('loading');

      void fetchBundleVersions(bundle.bundleId)
        .then(versions => {
          const items = versions.map(v => ({
            id: v.versionId,
            title: v.versionId.slice(0, 8),
            description: `Created: ${new Date(v.createdAt).toLocaleString()}`,
          }));
          setControlVersionItems(items);
          setTreatmentVersionItems(items);
          setControlVersionLoadState('loaded');
          setTreatmentVersionLoadState('loaded');
        })
        .catch(() => {
          setControlVersionLoadState('error');
          setTreatmentVersionLoadState('error');
        });
    },
    [deployedBundles, fetchBundleVersions, controlVersionItems.length]
  );

  // Step flags
  const isNameStep = wizard.step === 'name';
  const isDescriptionStep = wizard.step === 'description';
  const isGatewayStep = wizard.step === 'gateway';
  const isVariantsStep = wizard.step === 'variants';
  const isOnlineEvalStep = wizard.step === 'onlineEval';
  const isMaxDurationStep = wizard.step === 'maxDuration';
  const isEnableStep = wizard.step === 'enableOnCreate';
  const isConfirmStep = wizard.step === 'confirm';

  // Navigation hooks for select steps
  const onlineEvalNav = useListNavigation({
    items: onlineEvalItems,
    onSelect: item => wizard.setOnlineEval(item.id),
    onExit: () => wizard.goBack(),
    isActive: isOnlineEvalStep,
  });

  const enableNav = useListNavigation({
    items: enableItems,
    onSelect: item => wizard.setEnableOnCreate(item.id === 'yes'),
    onExit: () => wizard.goBack(),
    isActive: isEnableStep,
  });

  useListNavigation({
    items: [{ id: 'confirm', title: 'Confirm' }],
    onSelect: () => onComplete(wizard.config),
    onExit: () => wizard.goBack(),
    isActive: isConfirmStep,
  });

  // Help text
  const isSelectStep = isOnlineEvalStep || isEnableStep;
  const helpText = isSelectStep
    ? HELP_TEXT.NAVIGATE_SELECT
    : isConfirmStep
      ? HELP_TEXT.CONFIRM_CANCEL
      : isVariantsStep
        ? 'Enter to select · Esc back'
        : HELP_TEXT.TEXT_INPUT;

  const headerContent = <StepIndicator steps={wizard.steps} currentStep={wizard.step} labels={AB_TEST_STEP_LABELS} />;

  const controlWeight = 100 - wizard.config.treatmentWeight;

  return (
    <Screen title="Add AB Test" onExit={onExit} helpText={helpText} headerContent={headerContent} exitEnabled={false}>
      <Panel fullWidth>
        {isNameStep && (
          <TextInput
            key="name"
            prompt="AB test name"
            initialValue=""
            onSubmit={wizard.setName}
            onCancel={onExit}
            schema={ABTestNameSchema}
            customValidation={value => (existingTestNames.includes(value) ? `AB test "${value}" already exists` : true)}
          />
        )}

        {isDescriptionStep && (
          <TextInput
            key="description"
            prompt="Description (optional, press Enter to skip)"
            initialValue=""
            allowEmpty
            onSubmit={wizard.setDescription}
            onCancel={() => wizard.goBack()}
          />
        )}

        {isGatewayStep && (
          <TextInput
            key="gateway"
            prompt="Gateway ARN"
            initialValue=""
            onSubmit={wizard.setGateway}
            onCancel={() => wizard.goBack()}
            customValidation={(value: string) => (value.trim().length > 0 ? true : 'Gateway ARN is required')}
          />
        )}

        {isVariantsStep && (
          <VariantConfigForm
            bundleItems={bundleItems}
            fetchVersionItems={handleFetchVersions}
            controlVersionItems={controlVersionItems}
            treatmentVersionItems={treatmentVersionItems}
            controlVersionLoadState={controlVersionLoadState}
            treatmentVersionLoadState={treatmentVersionLoadState}
            onComplete={wizard.setVariants}
            onCancel={() => wizard.goBack()}
          />
        )}

        {isOnlineEvalStep && (
          <WizardSelect
            title="Select online evaluation config"
            items={onlineEvalItems}
            selectedIndex={onlineEvalNav.selectedIndex}
          />
        )}

        {isMaxDurationStep && (
          <TextInput
            key="maxDuration"
            prompt="Max duration in days (1-90, press Enter to skip)"
            initialValue=""
            allowEmpty
            onSubmit={value => {
              if (!value.trim()) {
                wizard.setMaxDuration(undefined);
                return;
              }
              const n = parseInt(value, 10);
              if (!isNaN(n) && n >= 1 && n <= 90) wizard.setMaxDuration(n);
            }}
            onCancel={() => wizard.goBack()}
            customValidation={(value: string) => {
              if (!value.trim()) return true;
              const n = parseInt(value, 10);
              if (isNaN(n)) return 'Must be a number';
              if (n < 1 || n > 90) return 'Must be between 1 and 90';
              return true;
            }}
          />
        )}

        {isEnableStep && (
          <WizardSelect
            title="Enable AB test on creation?"
            items={enableItems}
            selectedIndex={enableNav.selectedIndex}
          />
        )}

        {isConfirmStep && (
          <ConfirmReview
            fields={[
              { label: 'Name', value: wizard.config.name },
              ...(wizard.config.description ? [{ label: 'Description', value: wizard.config.description }] : []),
              { label: 'Gateway', value: wizard.config.gateway },
              { label: 'Control bundle', value: wizard.config.controlBundle },
              { label: 'Control version', value: wizard.config.controlVersion.slice(0, 8) },
              { label: 'Treatment bundle', value: wizard.config.treatmentBundle },
              { label: 'Treatment version', value: wizard.config.treatmentVersion.slice(0, 8) },
              {
                label: 'Traffic split',
                value: `Control ${controlWeight}% / Treatment ${wizard.config.treatmentWeight}%`,
              },
              { label: 'Online eval', value: wizard.config.onlineEval },
              ...(wizard.config.maxDuration
                ? [{ label: 'Max duration', value: `${wizard.config.maxDuration} days` }]
                : []),
              { label: 'Enable on create', value: wizard.config.enableOnCreate ? 'Yes' : 'No' },
            ]}
          />
        )}
      </Panel>
    </Screen>
  );
}
