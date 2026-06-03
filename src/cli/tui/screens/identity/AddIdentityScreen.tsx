import type { CredentialType } from '../../../../schema';
import { CredentialNameSchema } from '../../../../schema';
import { ConfirmReview, Panel, Screen, SecretInput, StepIndicator, TextInput, WizardSelect } from '../../components';
import type { SelectableItem } from '../../components';
import { HELP_TEXT } from '../../constants';
import { useListNavigation } from '../../hooks';
import { generateUniqueName } from '../../utils';
import type { AddIdentityConfig } from './types';
import { IDENTITY_STEP_LABELS, IDENTITY_TYPE_OPTIONS } from './types';
import { useAddIdentityWizard } from './useAddIdentityWizard';
import React, { useMemo } from 'react';

interface AddIdentityScreenProps {
  onComplete: (config: AddIdentityConfig) => void;
  onExit: () => void;
  existingIdentityNames: string[];
  initialType?: CredentialType;
}

export function AddIdentityScreen({ onComplete, onExit, existingIdentityNames, initialType }: AddIdentityScreenProps) {
  const wizard = useAddIdentityWizard(initialType);

  const typeItems: SelectableItem[] = useMemo(
    () => IDENTITY_TYPE_OPTIONS.map(opt => ({ id: opt.id, title: opt.title, description: opt.description })),
    []
  );

  const isTypeStep = wizard.step === 'type';
  const isNameStep = wizard.step === 'name';
  const isApiKeyStep = wizard.step === 'apiKey';
  const isOauthModeStep = wizard.step === 'oauthMode';
  const isDiscoveryUrlStep = wizard.step === 'discoveryUrl';
  const isAuthorizationUrlStep = wizard.step === 'authorizationUrl';
  const isTokenUrlStep = wizard.step === 'tokenUrl';
  const isClientIdStep = wizard.step === 'clientId';
  const isClientSecretStep = wizard.step === 'clientSecret';
  const isScopesStep = wizard.step === 'scopes';
  const isConfirmStep = wizard.step === 'confirm';
  const isOAuth = wizard.config.identityType === 'OAuthCredentialProvider';

  const oauthModeItems: SelectableItem[] = [
    {
      id: 'discovery',
      title: 'OIDC Discovery (recommended)',
      description: 'Most vendors expose a /.well-known/openid-configuration endpoint.',
    },
    {
      id: 'manual',
      title: 'Manual endpoints (CustomOauth2 / 3LO without discovery)',
      description: 'Specify authorization + token URLs directly. Required for some 3LO providers.',
    },
  ];

  const oauthModeNav = useListNavigation({
    items: oauthModeItems,
    onSelect: item => wizard.setOauthMode(item.id as 'discovery' | 'manual'),
    onExit: () => wizard.goBack(),
    isActive: isOauthModeStep,
  });

  const typeNav = useListNavigation({
    items: typeItems,
    onSelect: item => wizard.setIdentityType(item.id as CredentialType),
    onExit: () => onExit(),
    isActive: isTypeStep,
  });

  useListNavigation({
    items: [{ id: 'confirm', title: 'Confirm' }],
    onSelect: () => onComplete(wizard.config),
    onExit: () => wizard.goBack(),
    isActive: isConfirmStep,
  });

  // isOauthModeStep is a WizardSelect — must land in NAVIGATE_SELECT,
  // not in the TEXT_INPUT default arm. Without this branch, the user sees
  // text-input hints while on a list-selection screen.
  const helpText =
    isTypeStep || isOauthModeStep
      ? HELP_TEXT.NAVIGATE_SELECT
      : isConfirmStep
        ? HELP_TEXT.CONFIRM_CANCEL
        : HELP_TEXT.TEXT_INPUT;

  const headerContent = <StepIndicator steps={wizard.steps} currentStep={wizard.step} labels={IDENTITY_STEP_LABELS} />;

  const defaultName = isOAuth
    ? generateUniqueName('MyOAuth', existingIdentityNames)
    : generateUniqueName('MyApiKey', existingIdentityNames);

  return (
    <Screen title="Add Credential" onExit={onExit} helpText={helpText} headerContent={headerContent}>
      <Panel>
        {isTypeStep && (
          <WizardSelect
            title="Select credential type"
            description="Choose the type of credential provider"
            items={typeItems}
            selectedIndex={typeNav.selectedIndex}
          />
        )}

        {isNameStep && (
          <TextInput
            key="name"
            prompt="Credential name"
            initialValue={defaultName}
            onSubmit={wizard.setName}
            onCancel={() => wizard.goBack()}
            schema={CredentialNameSchema}
            customValidation={value => !existingIdentityNames.includes(value) || 'Credential name already exists'}
          />
        )}

        {isApiKeyStep && (
          <SecretInput
            key="apiKey"
            prompt="API Key"
            onSubmit={wizard.setApiKey}
            onCancel={() => wizard.goBack()}
            customValidation={value => value.trim().length > 0 || 'API key is required'}
            revealChars={4}
          />
        )}

        {isOauthModeStep && (
          <WizardSelect
            title="OAuth endpoint configuration"
            description="Most vendors support OIDC discovery; CustomOauth2 / non-discovery 3LO needs manual URLs."
            items={oauthModeItems}
            selectedIndex={oauthModeNav.selectedIndex}
          />
        )}

        {isDiscoveryUrlStep && (
          <TextInput
            key="discoveryUrl"
            prompt="Discovery URL (OIDC well-known endpoint)"
            placeholder="https://example.com/.well-known/openid-configuration"
            onSubmit={wizard.setDiscoveryUrl}
            onCancel={() => wizard.goBack()}
            customValidation={value => {
              try {
                new URL(value);
              } catch {
                return 'Must be a valid URL';
              }
              if (!value.endsWith('/.well-known/openid-configuration')) {
                return "URL must end with '/.well-known/openid-configuration'";
              }
              return true;
            }}
          />
        )}

        {isAuthorizationUrlStep && (
          <TextInput
            key="authorizationUrl"
            prompt="Authorization endpoint URL"
            placeholder="https://accounts.example.com/oauth2/authorize"
            onSubmit={wizard.setAuthorizationUrl}
            onCancel={() => wizard.goBack()}
            customValidation={value => {
              try {
                const u = new URL(value);
                if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Must be http(s)';
              } catch {
                return 'Must be a valid URL';
              }
              return true;
            }}
          />
        )}

        {isTokenUrlStep && (
          <TextInput
            key="tokenUrl"
            prompt="Token endpoint URL"
            placeholder="https://accounts.example.com/oauth2/token"
            onSubmit={wizard.setTokenUrl}
            onCancel={() => wizard.goBack()}
            customValidation={value => {
              try {
                const u = new URL(value);
                if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Must be http(s)';
              } catch {
                return 'Must be a valid URL';
              }
              return true;
            }}
          />
        )}

        {isClientIdStep && (
          <SecretInput
            key="clientId"
            prompt="Client ID"
            onSubmit={wizard.setClientId}
            onCancel={() => wizard.goBack()}
            customValidation={value => value.trim().length > 0 || 'Client ID is required'}
            revealChars={4}
          />
        )}

        {isClientSecretStep && (
          <SecretInput
            key="clientSecret"
            prompt="Client Secret"
            onSubmit={wizard.setClientSecret}
            onCancel={() => wizard.goBack()}
            customValidation={value => value.trim().length > 0 || 'Client secret is required'}
            revealChars={4}
          />
        )}

        {isScopesStep && (
          <TextInput
            key="scopes"
            prompt="Scopes (comma-separated, optional)"
            placeholder="press Enter to skip"
            initialValue=""
            onSubmit={wizard.setScopes}
            onCancel={() => wizard.goBack()}
            allowEmpty
          />
        )}

        {isConfirmStep && (
          <ConfirmReview
            fields={
              isOAuth
                ? [
                    { label: 'Type', value: 'OAuth' },
                    { label: 'Name', value: wizard.config.name },
                    ...(wizard.config.oauthMode === 'manual'
                      ? [
                          { label: 'Authorization URL', value: wizard.config.authorizationUrl ?? '' },
                          { label: 'Token URL', value: wizard.config.tokenUrl ?? '' },
                        ]
                      : [{ label: 'Discovery URL', value: wizard.config.discoveryUrl ?? '' }]),
                    {
                      label: 'Client ID',
                      value: wizard.config.clientId ? '****' + wizard.config.clientId.slice(-4) : '',
                    },
                    ...(wizard.config.scopes ? [{ label: 'Scopes', value: wizard.config.scopes }] : []),
                  ]
                : [
                    { label: 'Type', value: 'API Key' },
                    { label: 'Name', value: wizard.config.name },
                    { label: 'API Key', value: '*'.repeat(Math.min(wizard.config.apiKey.length, 20)) },
                  ]
            }
          />
        )}
      </Panel>
    </Screen>
  );
}
