import { ComponentConfigurationMapSchema } from '../../../../schema';
import type { SelectableItem } from '../../components';
import { ConfirmReview, Panel, Screen, StepIndicator, TextInput, WizardSelect } from '../../components';
import { HELP_TEXT } from '../../constants';
import { useListNavigation } from '../../hooks';
import type { ComponentInputMethod } from './types';
import { INPUT_METHOD_OPTIONS } from './types';
import type { EditConfigBundleConfig } from './useEditConfigBundleWizard';
import { EDIT_STEP_LABELS, useEditConfigBundleWizard } from './useEditConfigBundleWizard';
import { existsSync, readFileSync } from 'fs';
import React, { useMemo } from 'react';

interface EditConfigBundleScreenProps {
  onComplete: (config: EditConfigBundleConfig) => void;
  onExit: () => void;
  /** Existing bundle names available for editing. */
  bundleNames: string[];
}

function validateComponentsJson(value: string): string | true {
  try {
    const parsed: unknown = JSON.parse(value);
    ComponentConfigurationMapSchema.parse(parsed);
    return true;
  } catch (err) {
    if (err instanceof SyntaxError) {
      return 'Invalid JSON syntax';
    }
    return 'Must be a map of component ARN to { configuration: { ... } }';
  }
}

function validateComponentsFile(value: string): string | true {
  if (!value.trim()) return 'File path is required';
  if (!existsSync(value.trim())) return `File not found: ${value.trim()}`;
  try {
    const raw = readFileSync(value.trim(), 'utf-8');
    return validateComponentsJson(raw);
  } catch {
    return 'Failed to read file';
  }
}

export function EditConfigBundleScreen({ onComplete, onExit, bundleNames }: EditConfigBundleScreenProps) {
  const wizard = useEditConfigBundleWizard();

  const bundleItems: SelectableItem[] = useMemo(
    () => bundleNames.map(name => ({ id: name, title: name })),
    [bundleNames]
  );

  const inputMethodItems: SelectableItem[] = useMemo(
    () => INPUT_METHOD_OPTIONS.map(opt => ({ id: opt.id, title: opt.title, description: opt.description })),
    []
  );

  const isSelectBundleStep = wizard.step === 'selectBundle';
  const isInputMethodStep = wizard.step === 'inputMethod';
  const isComponentsStep = wizard.step === 'components';
  const isCommitMessageStep = wizard.step === 'commitMessage';
  const isBranchNameStep = wizard.step === 'branchName';
  const isConfirmStep = wizard.step === 'confirm';

  const bundleNav = useListNavigation({
    items: bundleItems,
    onSelect: item => wizard.selectBundle(item.id),
    onExit,
    isActive: isSelectBundleStep,
  });

  const inputMethodNav = useListNavigation({
    items: inputMethodItems,
    onSelect: item => wizard.setInputMethod(item.id as ComponentInputMethod),
    onExit: () => wizard.goBack(),
    isActive: isInputMethodStep,
  });

  useListNavigation({
    items: [{ id: 'confirm', title: 'Confirm' }],
    onSelect: () => onComplete(wizard.config),
    onExit: () => wizard.goBack(),
    isActive: isConfirmStep,
  });

  const helpText =
    isSelectBundleStep || isInputMethodStep
      ? HELP_TEXT.NAVIGATE_SELECT
      : isConfirmStep
        ? HELP_TEXT.CONFIRM_CANCEL
        : HELP_TEXT.TEXT_INPUT;

  const headerContent = <StepIndicator steps={wizard.steps} currentStep={wizard.step} labels={EDIT_STEP_LABELS} />;

  const componentsPreview =
    wizard.config.inputMethod === 'file'
      ? wizard.config.componentsRaw
      : Object.keys(wizard.config.components).length > 0
        ? `${Object.keys(wizard.config.components).length} component(s)`
        : '';

  return (
    <Screen
      title="Edit Configuration Bundle"
      onExit={onExit}
      helpText={helpText}
      headerContent={headerContent}
      exitEnabled={false}
    >
      <Panel fullWidth>
        {isSelectBundleStep && (
          <WizardSelect
            title="Select bundle to edit"
            description="Choose the configuration bundle to update"
            items={bundleItems}
            selectedIndex={bundleNav.selectedIndex}
          />
        )}

        {isInputMethodStep && (
          <WizardSelect
            title="How do you want to provide updated components?"
            description="Choose input method for new component configurations"
            items={inputMethodItems}
            selectedIndex={inputMethodNav.selectedIndex}
          />
        )}

        {isComponentsStep && wizard.config.inputMethod === 'inline' && (
          <TextInput
            key="components-inline"
            prompt="Component configurations (JSON)"
            initialValue=""
            expandable
            onSubmit={value => {
              const parsed = JSON.parse(value) as Record<string, { configuration: Record<string, unknown> }>;
              wizard.setComponents(parsed, value);
            }}
            onCancel={() => wizard.goBack()}
            customValidation={validateComponentsJson}
          />
        )}

        {isComponentsStep && wizard.config.inputMethod === 'file' && (
          <TextInput
            key="components-file"
            prompt="Path to components JSON file"
            initialValue=""
            onSubmit={value => {
              const raw = readFileSync(value.trim(), 'utf-8');
              const parsed = JSON.parse(raw) as Record<string, { configuration: Record<string, unknown> }>;
              wizard.setComponents(parsed, value.trim());
            }}
            onCancel={() => wizard.goBack()}
            customValidation={validateComponentsFile}
          />
        )}

        {isCommitMessageStep && (
          <TextInput
            key="commitMessage"
            prompt="Commit message (press Enter for default)"
            placeholder={`Update ${wizard.config.bundleName}`}
            initialValue=""
            allowEmpty
            onSubmit={wizard.setCommitMessage}
            onCancel={() => wizard.goBack()}
          />
        )}

        {isBranchNameStep && (
          <TextInput
            key="branchName"
            prompt="Branch name (press Enter to keep current)"
            placeholder="main"
            initialValue=""
            allowEmpty
            onSubmit={wizard.setBranchName}
            onCancel={() => wizard.goBack()}
          />
        )}

        {isConfirmStep && (
          <ConfirmReview
            fields={[
              { label: 'Bundle', value: wizard.config.bundleName },
              { label: 'Components', value: componentsPreview },
              { label: 'Message', value: wizard.config.commitMessage || `Update ${wizard.config.bundleName}` },
              { label: 'Branch', value: wizard.config.branchName || 'mainline' },
            ]}
          />
        )}
      </Panel>
    </Screen>
  );
}
