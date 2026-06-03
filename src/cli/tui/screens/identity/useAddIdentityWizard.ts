import type { CredentialType } from '../../../../schema';
import type { AddIdentityConfig, AddIdentityStep, OAuthEndpointMode } from './types';
import { useCallback, useMemo, useState } from 'react';

function getSteps(
  identityType: CredentialType,
  skipTypeStep: boolean,
  oauthMode?: OAuthEndpointMode
): AddIdentityStep[] {
  let steps: AddIdentityStep[];
  if (identityType === 'OAuthCredentialProvider') {
    // The OAuth path branches: 'discovery' uses discoveryUrl (covers all
    // standard vendors); 'manual' captures authorizationUrl + tokenUrl
    // (CustomOauth2 vendors backing 3LO targets without OIDC discovery).
    // The branch step asks the user to pick between the two modes.
    if (oauthMode === 'manual') {
      steps = [
        'type',
        'name',
        'oauthMode',
        'authorizationUrl',
        'tokenUrl',
        'clientId',
        'clientSecret',
        'scopes',
        'confirm',
      ];
    } else {
      // 'discovery' is the default; render the same two-step intro then
      // collect discoveryUrl alone.
      steps = ['type', 'name', 'oauthMode', 'discoveryUrl', 'clientId', 'clientSecret', 'scopes', 'confirm'];
    }
  } else {
    steps = ['type', 'name', 'apiKey', 'confirm'];
  }

  return skipTypeStep ? steps.filter(s => s !== 'type') : steps;
}

function getDefaultConfig(initialType?: CredentialType): AddIdentityConfig {
  return {
    identityType: initialType ?? 'ApiKeyCredentialProvider',
    name: '',
    apiKey: '',
  };
}

export function useAddIdentityWizard(initialType?: CredentialType) {
  const hasInitialType = initialType !== undefined;
  const [config, setConfig] = useState<AddIdentityConfig>(() => getDefaultConfig(initialType));
  const [step, setStep] = useState<AddIdentityStep>(hasInitialType ? 'name' : 'type');

  const steps = useMemo(
    () => getSteps(config.identityType, hasInitialType, config.oauthMode),
    [config.identityType, hasInitialType, config.oauthMode]
  );
  const currentIndex = steps.indexOf(step);

  const goBack = useCallback(() => {
    const prevStep = steps[currentIndex - 1];
    if (prevStep) setStep(prevStep);
  }, [currentIndex, steps]);

  const advanceFrom = useCallback(
    (currentStep: AddIdentityStep) => {
      const currentSteps = getSteps(config.identityType, hasInitialType, config.oauthMode);
      const idx = currentSteps.indexOf(currentStep);
      const next = currentSteps[idx + 1];
      if (next) setStep(next);
    },
    [config.identityType, hasInitialType, config.oauthMode]
  );

  const setIdentityType = useCallback((identityType: CredentialType) => {
    setConfig(c => ({
      ...c,
      identityType,
      apiKey: '',
      oauthMode: undefined,
      discoveryUrl: undefined,
      authorizationUrl: undefined,
      tokenUrl: undefined,
      clientId: undefined,
      clientSecret: undefined,
      scopes: undefined,
    }));
    setStep('name');
  }, []);

  const setName = useCallback(
    (name: string) => {
      setConfig(c => ({ ...c, name }));
      advanceFrom('name');
    },
    [advanceFrom]
  );

  const setApiKey = useCallback(
    (apiKey: string) => {
      setConfig(c => ({ ...c, apiKey }));
      advanceFrom('apiKey');
    },
    [advanceFrom]
  );

  const setOauthMode = useCallback((oauthMode: OAuthEndpointMode) => {
    setConfig(c => ({ ...c, oauthMode }));
    // The next step depends on the chosen mode — set explicitly because
    // useMemo for `steps` recomputes asynchronously after this state set.
    setStep(oauthMode === 'manual' ? 'authorizationUrl' : 'discoveryUrl');
  }, []);

  const setDiscoveryUrl = useCallback(
    (discoveryUrl: string) => {
      setConfig(c => ({ ...c, discoveryUrl }));
      advanceFrom('discoveryUrl');
    },
    [advanceFrom]
  );

  const setAuthorizationUrl = useCallback(
    (authorizationUrl: string) => {
      setConfig(c => ({ ...c, authorizationUrl }));
      advanceFrom('authorizationUrl');
    },
    [advanceFrom]
  );

  const setTokenUrl = useCallback(
    (tokenUrl: string) => {
      setConfig(c => ({ ...c, tokenUrl }));
      advanceFrom('tokenUrl');
    },
    [advanceFrom]
  );

  const setClientId = useCallback(
    (clientId: string) => {
      setConfig(c => ({ ...c, clientId }));
      advanceFrom('clientId');
    },
    [advanceFrom]
  );

  const setClientSecret = useCallback(
    (clientSecret: string) => {
      setConfig(c => ({ ...c, clientSecret }));
      advanceFrom('clientSecret');
    },
    [advanceFrom]
  );

  const setScopes = useCallback(
    (scopes: string) => {
      setConfig(c => ({ ...c, scopes: scopes || undefined }));
      advanceFrom('scopes');
    },
    [advanceFrom]
  );

  const reset = useCallback(() => {
    setConfig(getDefaultConfig(initialType));
    setStep(hasInitialType ? 'name' : 'type');
  }, [initialType, hasInitialType]);

  return {
    config,
    step,
    steps,
    currentIndex,
    goBack,
    setIdentityType,
    setName,
    setApiKey,
    setOauthMode,
    setDiscoveryUrl,
    setAuthorizationUrl,
    setTokenUrl,
    setClientId,
    setClientSecret,
    setScopes,
    reset,
  };
}
