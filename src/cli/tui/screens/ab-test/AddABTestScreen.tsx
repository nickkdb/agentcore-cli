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
import { Text } from 'ink';
import React, { useCallback, useEffect, useMemo } from 'react';

function formatVersionDate(value: string): string {
  const n = Number(value);
  if (!isNaN(n) && n > 0) {
    // Epoch seconds (< 1e12) vs milliseconds (>= 1e12)
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toLocaleString();
  }
  return new Date(value).toLocaleString();
}

interface AddABTestScreenProps {
  onComplete: (config: AddABTestConfig) => void;
  onExit: () => void;
  existingTestNames: string[];
  agents: { name: string }[];
  existingHttpGateways: string[];
  deployedBundles: { name: string; bundleId: string }[];
  onlineEvalConfigs: string[];
  fetchBundleVersions: (bundleId: string) => Promise<{ versionId: string; createdAt: string }[]>;
  onCreateBundle?: () => void;
}

export function AddABTestScreen({
  onComplete,
  onExit,
  existingTestNames,
  agents,
  existingHttpGateways,
  deployedBundles,
  onlineEvalConfigs,
  fetchBundleVersions,
  onCreateBundle,
}: AddABTestScreenProps) {
  const wizard = useAddABTestWizard();

  // Build select items
  const agentItems: SelectableItem[] = useMemo(
    () => agents.map(a => ({ id: a.name, title: a.name, description: 'Agent' })),
    [agents]
  );

  const bundleItems: SelectableItem[] = useMemo(
    () => deployedBundles.map(b => ({ id: b.name, title: b.name, description: `ID: ${b.bundleId}` })),
    [deployedBundles]
  );

  const onlineEvalItems: SelectableItem[] = useMemo(
    () => onlineEvalConfigs.map(name => ({ id: name, title: name, description: 'Online Eval Config' })),
    [onlineEvalConfigs]
  );

  const gatewayItems: SelectableItem[] = useMemo(() => {
    const items: SelectableItem[] = [
      { id: '__create_new__', title: 'Create new HTTP gateway', description: 'Auto-create for this AB test' },
    ];
    for (const gwName of existingHttpGateways) {
      items.push({ id: gwName, title: gwName, description: 'Existing HTTP gateway' });
    }
    return items;
  }, [existingHttpGateways]);

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
            description: `Created: ${formatVersionDate(v.createdAt)}`,
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
    [deployedBundles, fetchBundleVersions]
  );

  // Step flags
  const isNameStep = wizard.step === 'name';
  const isDescriptionStep = wizard.step === 'description';
  const isAgentStep = wizard.step === 'agent';
  const isGatewayStep = wizard.step === 'gateway';
  const isVariantsStep = wizard.step === 'variants';
  const isOnlineEvalStep = wizard.step === 'onlineEval';
  // TODO(post-preview): Re-enable maxDuration step once configurable duration is launched.
  // const isMaxDurationStep = wizard.step === 'maxDuration';
  const isEnableStep = wizard.step === 'enableOnCreate';
  const isConfirmStep = wizard.step === 'confirm';

  // Tell the wizard which steps to skip (both forward and backward navigation).
  // The gateway step is skipped when there are no existing gateways — the default
  // config already sets gatewayChoice to 'create-new'.
  // Track gateway choice type in a ref so the skip check always has the latest value,
  // even before React re-renders after setGateway updates state.
  const gatewayChoiceTypeRef = React.useRef(wizard.config.gatewayChoice.type);

  const shouldSkipStep = useCallback((s: string) => {
    // Agent selection is only needed when auto-creating a gateway (to set the runtime target).
    // When using an existing gateway, the runtime is already configured.
    if (s === 'agent' && gatewayChoiceTypeRef.current !== 'create-new') return true;
    // TODO(post-preview): Re-enable maxDuration step once configurable duration is launched.
    // For public preview, a 14-day default is enforced server-side.
    if (s === 'maxDuration') return true;
    return false;
  }, []);

  useEffect(() => {
    wizard.setSkipCheck(shouldSkipStep);
  }, [shouldSkipStep]); // wizard.setSkipCheck is stable (useCallback with no deps)

  // Navigation hooks for select steps
  const agentNav = useListNavigation({
    items: agentItems,
    onSelect: item => wizard.setAgent(item.id),
    onExit: () => wizard.goBack(),
    isActive: isAgentStep,
  });

  const gatewayNav = useListNavigation({
    items: gatewayItems,
    onSelect: item => {
      const choice =
        item.id === '__create_new__'
          ? ({ type: 'create-new' } as const)
          : ({ type: 'existing-http', name: item.id } as const);
      // Update ref before setGateway so the skip check sees the new choice
      // when advance() runs synchronously in the same call.
      gatewayChoiceTypeRef.current = choice.type;
      wizard.setGateway(choice);
    },
    onExit: () => wizard.goBack(),
    isActive: isGatewayStep,
  });

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
  const isSelectStep = isAgentStep || isGatewayStep || isOnlineEvalStep || isEnableStep;
  const helpText = isSelectStep
    ? HELP_TEXT.NAVIGATE_SELECT
    : isConfirmStep
      ? HELP_TEXT.CONFIRM_CANCEL
      : isVariantsStep
        ? HELP_TEXT.VARIANTS_FORM
        : HELP_TEXT.TEXT_INPUT;

  const headerContent = <StepIndicator steps={wizard.steps} currentStep={wizard.step} labels={AB_TEST_STEP_LABELS} />;

  const controlWeight = 100 - wizard.config.treatmentWeight;

  return (
    <Screen title="Add AB Test [preview]" onExit={onExit} helpText={helpText} headerContent={headerContent} exitEnabled={false}>
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

        {isAgentStep && <WizardSelect title="Select agent" items={agentItems} selectedIndex={agentNav.selectedIndex} />}

        {isGatewayStep && (
          <WizardSelect title="Select gateway" items={gatewayItems} selectedIndex={gatewayNav.selectedIndex} />
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
            onCreateBundle={onCreateBundle}
          />
        )}

        {isOnlineEvalStep &&
          (onlineEvalItems.length > 0 ? (
            <WizardSelect
              title="Select online evaluation config"
              items={onlineEvalItems}
              selectedIndex={onlineEvalNav.selectedIndex}
            />
          ) : (
            <Text color="red">
              No online eval configs found. An online eval is required for AB tests. Add one with `agentcore add
              online-eval`, then retry. Press Esc to go back.
            </Text>
          ))}

        {/* TODO(post-preview): Re-enable maxDuration TextInput once configurable duration is launched. */}

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
              {
                label: 'Gateway',
                value:
                  wizard.config.gatewayChoice.type === 'create-new'
                    ? `Create new for ${wizard.config.agent} (auto)`
                    : wizard.config.gatewayChoice.name,
              },
              { label: 'Control bundle', value: wizard.config.controlBundle },
              { label: 'Control version', value: wizard.config.controlVersion.slice(0, 8) },
              { label: 'Treatment bundle', value: wizard.config.treatmentBundle },
              { label: 'Treatment version', value: wizard.config.treatmentVersion.slice(0, 8) },
              {
                label: 'Traffic split',
                value: `Control ${controlWeight}% / Treatment ${wizard.config.treatmentWeight}%`,
              },
              { label: 'Online eval', value: wizard.config.onlineEval },
              // TODO(post-preview): Re-enable max duration display once configurable duration is launched.
              { label: 'Enable on create', value: wizard.config.enableOnCreate ? 'Yes' : 'No' },
            ]}
          />
        )}
      </Panel>
    </Screen>
  );
}
