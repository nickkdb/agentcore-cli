import { ComponentConfigurationMapSchema, ConfigBundleNameSchema } from '../../../../schema';
import type { SelectableItem } from '../../components';
import { ConfirmReview, Panel, Screen, StepIndicator, TextInput, WizardSelect } from '../../components';
import { HELP_TEXT } from '../../constants';
import { useListNavigation } from '../../hooks';
import { generateUniqueName } from '../../utils';
import type { AddConfigBundleConfig, ComponentInputMethod } from './types';
import { CONFIG_BUNDLE_STEP_LABELS, INPUT_METHOD_OPTIONS } from './types';
import { useAddConfigBundleWizard } from './useAddConfigBundleWizard';
import { existsSync, readFileSync } from 'fs';
import React, { useMemo } from 'react';

interface AddConfigBundleScreenProps {
  onComplete: (config: AddConfigBundleConfig) => void;
  onExit: () => void;
  existingBundleNames: string[];
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

export function AddConfigBundleScreen({ onComplete, onExit, existingBundleNames }: AddConfigBundleScreenProps) {
  const wizard = useAddConfigBundleWizard();

  const inputMethodItems: SelectableItem[] = useMemo(
    () => INPUT_METHOD_OPTIONS.map(opt => ({ id: opt.id, title: opt.title, description: opt.description })),
    []
  );

  const isNameStep = wizard.step === 'name';
  const isDescriptionStep = wizard.step === 'description';
  const isInputMethodStep = wizard.step === 'inputMethod';
  const isComponentsStep = wizard.step === 'components';
  const isBranchNameStep = wizard.step === 'branchName';
  const isCommitMessageStep = wizard.step === 'commitMessage';
  const isConfirmStep = wizard.step === 'confirm';

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

  const helpText = isInputMethodStep
    ? HELP_TEXT.NAVIGATE_SELECT
    : isConfirmStep
      ? HELP_TEXT.CONFIRM_CANCEL
      : HELP_TEXT.TEXT_INPUT;

  const headerContent = (
    <StepIndicator steps={wizard.steps} currentStep={wizard.step} labels={CONFIG_BUNDLE_STEP_LABELS} />
  );

  const componentsPreview =
    wizard.config.inputMethod === 'file'
      ? wizard.config.componentsRaw
      : Object.keys(wizard.config.components).length > 0
        ? `${Object.keys(wizard.config.components).length} component(s)`
        : '';

  return (
    <Screen
      title="Add Configuration Bundle"
      onExit={onExit}
      helpText={helpText}
      headerContent={headerContent}
      exitEnabled={false}
    >
      <Panel fullWidth>
        {isNameStep && (
          <TextInput
            key="name"
            prompt="Bundle name"
            initialValue={generateUniqueName('MyBundle', existingBundleNames)}
            onSubmit={wizard.setName}
            onCancel={onExit}
            schema={ConfigBundleNameSchema}
            customValidation={value => !existingBundleNames.includes(value) || 'Bundle name already exists'}
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

        {isInputMethodStep && (
          <WizardSelect
            title="Component input method"
            description="How to provide component configurations"
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

        {isBranchNameStep && (
          <TextInput
            key="branchName"
            prompt="Branch name (press Enter for default)"
            placeholder="main"
            initialValue=""
            allowEmpty
            onSubmit={wizard.setBranchName}
            onCancel={() => wizard.goBack()}
          />
        )}

        {isCommitMessageStep && (
          <TextInput
            key="commitMessage"
            prompt="Commit message (press Enter for default)"
            placeholder={`Create ${wizard.config.name}`}
            initialValue=""
            allowEmpty
            onSubmit={wizard.setCommitMessage}
            onCancel={() => wizard.goBack()}
          />
        )}

        {isConfirmStep && (
          <ConfirmReview
            fields={[
              { label: 'Name', value: wizard.config.name },
              ...(wizard.config.description ? [{ label: 'Description', value: wizard.config.description }] : []),
              { label: 'Components', value: componentsPreview },
              { label: 'Branch', value: wizard.config.branchName || 'main' },
              { label: 'Message', value: wizard.config.commitMessage || `Create ${wizard.config.name}` },
            ]}
          />
        )}
      </Panel>
    </Screen>
  );
}
