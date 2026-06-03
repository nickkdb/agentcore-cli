import { APP_DIR, MCP_APP_SUBDIR } from '../../../../lib';
import type { ApiGatewayHttpMethod, GatewayTargetType, SchemaSource, ToolDefinition } from '../../../../schema';
import type { AddGatewayTargetStep, GatewayTargetWizardState } from './types';
import { useCallback, useMemo, useState } from 'react';

function deriveToolDefinition(name: string): ToolDefinition {
  return {
    name,
    description: `Tool for ${name}`,
    inputSchema: { type: 'object' },
  };
}

function getDefaultConfig(): GatewayTargetWizardState {
  return {
    name: '',
    description: '',
    sourcePath: '',
    language: 'Python',
    host: 'Lambda',
    toolDefinition: deriveToolDefinition(''),
  };
}

export function useAddGatewayTargetWizard(
  existingGateways: string[] = [],
  initialConfig?: GatewayTargetWizardState,
  initialStep?: AddGatewayTargetStep
) {
  const [config, setConfig] = useState<GatewayTargetWizardState>(() => initialConfig ?? getDefaultConfig());
  const [step, setStep] = useState<AddGatewayTargetStep>(initialStep ?? 'name');

  // Dynamic steps — recomputes when targetType OR outboundAuth changes.
  // The grant-type + three-lo-scopes steps are inserted after outbound-auth
  // when the user picked OAUTH on a target type that supports 3LO
  // (mcpServer / openApiSchema). 2LO and non-OAUTH paths skip them.
  const steps = useMemo<AddGatewayTargetStep[]>(() => {
    const baseSteps: AddGatewayTargetStep[] = ['name', 'target-type'];
    if (config.targetType) {
      switch (config.targetType) {
        case 'apiGateway':
          baseSteps.push('rest-api-id', 'stage', 'tool-filters', 'gateway', 'api-gateway-auth');
          break;
        case 'openApiSchema':
          baseSteps.push('schema-source', 'gateway', 'outbound-auth');
          break;
        case 'smithyModel':
          baseSteps.push('schema-source', 'gateway');
          break;
        case 'lambdaFunctionArn':
          baseSteps.push('lambda-arn', 'tool-schema', 'gateway');
          break;
        case 'mcpServer':
        default:
          baseSteps.push('endpoint', 'gateway', 'outbound-auth');
          break;
      }
      // Insert 3LO sub-steps after outbound-auth when applicable.
      if (config.outboundAuth?.type === 'OAUTH') {
        baseSteps.push('grant-type');
        if (config.outboundAuth.grantType === 'AUTHORIZATION_CODE') {
          baseSteps.push('three-lo-scopes');
        }
      }
      baseSteps.push('confirm');
    }
    return baseSteps;
  }, [config.targetType, config.outboundAuth?.type, config.outboundAuth?.grantType]);

  const currentIndex = steps.indexOf(step);

  const goToNextStep = useCallback(() => {
    const idx = steps.indexOf(step);
    const next = steps[idx + 1];
    if (idx >= 0 && next) {
      setStep(next);
    }
  }, [steps, step]);

  const goBack = useCallback(() => {
    const prevStep = steps[currentIndex - 1];
    if (prevStep) setStep(prevStep);
  }, [currentIndex, steps]);

  const setName = useCallback(
    (name: string) => {
      setConfig(c => ({
        ...c,
        name,
        description: `Tool for ${name}`,
        sourcePath: `${APP_DIR}/${MCP_APP_SUBDIR}/${name}`,
        toolDefinition: deriveToolDefinition(name),
      }));
      goToNextStep();
    },
    [goToNextStep]
  );

  const setTargetType = useCallback((targetType: GatewayTargetType) => {
    setConfig(c => ({ ...c, targetType }));
    // Cannot use goToNextStep() here — config.targetType is changing, which triggers
    // useMemo to recompute steps, but goToNextStep captures the OLD steps via closure.
    // Must explicitly set the first type-specific step.
    switch (targetType) {
      case 'apiGateway':
        setStep('rest-api-id');
        break;
      case 'openApiSchema':
      case 'smithyModel':
        setStep('schema-source');
        break;
      case 'lambdaFunctionArn':
        setStep('lambda-arn');
        break;
      case 'mcpServer':
      default:
        setStep('endpoint');
        break;
    }
  }, []);

  const setEndpoint = useCallback(
    (endpoint: string) => {
      setConfig(c => ({
        ...c,
        endpoint,
      }));
      goToNextStep();
    },
    [goToNextStep]
  );

  const setSchemaSource = useCallback(
    (schemaSource: SchemaSource) => {
      setConfig(c => ({ ...c, schemaSource }));
      goToNextStep();
    },
    [goToNextStep]
  );

  const setGateway = useCallback(
    (gateway: string) => {
      setConfig(c => ({ ...c, gateway }));
      goToNextStep();
    },
    [goToNextStep]
  );

  const setOutboundAuth = useCallback(
    (outboundAuth: { type: 'OAUTH' | 'API_KEY' | 'NONE'; credentialName?: string }) => {
      setConfig(c => ({
        ...c,
        outboundAuth: {
          ...c.outboundAuth,
          ...outboundAuth,
        },
      }));
      // OAUTH adds a grant-type sub-step that the cached `steps` array
      // doesn't include yet (useMemo recomputes asynchronously). Set the
      // next step explicitly to bypass the stale closure.
      if (outboundAuth.type === 'OAUTH') {
        setStep('grant-type');
      } else {
        goToNextStep();
      }
    },
    [goToNextStep]
  );

  /**
   * Set the OAuth grant type and route to the next wizard step.
   * AUTHORIZATION_CODE goes to three-lo-scopes for return-URL + custom-params
   * collection; CLIENT_CREDENTIALS goes straight to confirm.
   */
  const setGrantType = useCallback((grantType: 'CLIENT_CREDENTIALS' | 'AUTHORIZATION_CODE') => {
    setConfig(c => {
      if (!c.outboundAuth) return c;
      const next = { ...c.outboundAuth, grantType };
      // When the user switches AUTHORIZATION_CODE → CLIENT_CREDENTIALS
      // (e.g. via Back then re-select), drop any 3LO-only fields the prior
      // path collected. Otherwise the schema's superRefine rejects them at
      // write time with a confusing post-wizard error.
      if (grantType !== 'AUTHORIZATION_CODE') {
        delete next.defaultReturnUrl;
        delete next.customParameters;
      }
      return { ...c, outboundAuth: next };
    });
    // Cannot use goToNextStep — the steps array depends on grantType, which
    // we just changed. Set the next step explicitly based on the new value.
    if (grantType === 'AUTHORIZATION_CODE') {
      setStep('three-lo-scopes');
    } else {
      setStep('confirm');
    }
  }, []);

  /**
   * Set the 3LO-only fields (defaultReturnUrl + optional customParameters)
   * and advance to confirm. customParameters is a key-value record; pass
   * undefined or {} to omit it from the rendered config.
   */
  const setThreeLoFields = useCallback(
    (fields: { defaultReturnUrl?: string; customParameters?: Record<string, string> }) => {
      setConfig(c => {
        if (!c.outboundAuth) return c;
        const next = { ...c.outboundAuth };
        if (fields.defaultReturnUrl !== undefined && fields.defaultReturnUrl !== '') {
          next.defaultReturnUrl = fields.defaultReturnUrl;
        }
        if (fields.customParameters && Object.keys(fields.customParameters).length > 0) {
          next.customParameters = fields.customParameters;
        }
        return { ...c, outboundAuth: next };
      });
      goToNextStep();
    },
    [goToNextStep]
  );

  const reset = useCallback(() => {
    setConfig(getDefaultConfig());
    setStep('name');
  }, []);

  const setRestApiId = useCallback(
    (restApiId: string) => {
      setConfig(c => ({ ...c, restApiId }));
      goToNextStep();
    },
    [goToNextStep]
  );

  const setStage = useCallback(
    (stage: string) => {
      setConfig(c => ({ ...c, stage }));
      goToNextStep();
    },
    [goToNextStep]
  );

  const setToolFilters = useCallback(
    (toolFilters: { filterPath: string; methods: ApiGatewayHttpMethod[] }[]) => {
      setConfig(c => ({ ...c, toolFilters }));
      goToNextStep();
    },
    [goToNextStep]
  );

  const setApiGatewayAuth = useCallback(
    (outboundAuth?: { type: 'API_KEY' | 'NONE'; credentialName?: string }) => {
      setConfig(c => ({ ...c, outboundAuth }));
      goToNextStep();
    },
    [goToNextStep]
  );

  const setLambdaArn = useCallback(
    (lambdaArn: string) => {
      setConfig(c => ({ ...c, lambdaArn }));
      goToNextStep();
    },
    [goToNextStep]
  );

  const setToolSchemaFile = useCallback(
    (toolSchemaFile: string) => {
      setConfig(c => ({ ...c, toolSchemaFile }));
      goToNextStep();
    },
    [goToNextStep]
  );

  return {
    config,
    step,
    steps,
    currentIndex,
    existingGateways,
    goBack,
    setName,
    setTargetType,
    setEndpoint,
    setSchemaSource,
    setGateway,
    setOutboundAuth,
    setGrantType,
    setThreeLoFields,
    setRestApiId,
    setStage,
    setToolFilters,
    setApiGatewayAuth,
    setLambdaArn,
    setToolSchemaFile,
    reset,
  };
}
