import { buildHarnessBaseOpts } from '../action.js';
import type { InvokeOptions } from '../types.js';
import { describe, expect, it } from 'vitest';

describe('buildHarnessBaseOpts', () => {
  describe('preserves model inference params from harness spec when overriding model', () => {
    it('bedrock: includes temperature, topP, and maxTokens', () => {
      const options: InvokeOptions = { modelId: 'anthropic.claude-v3' };
      const harnessSpec = {
        provider: 'bedrock' as const,
        modelId: 'anthropic.claude-v2',
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 500,
      };

      const result = buildHarnessBaseOpts(options, harnessSpec);

      expect(result.model).toEqual({
        bedrockModelConfig: {
          modelId: 'anthropic.claude-v3',
          temperature: 0.7,
          topP: 0.9,
          maxTokens: 500,
        },
      });
    });

    it('open_ai: includes temperature, topP, maxTokens, and apiKeyArn', () => {
      const options: InvokeOptions = { modelId: 'gpt-5' };
      const harnessSpec = {
        provider: 'open_ai' as const,
        modelId: 'gpt-4',
        apiKeyArn: 'arn:aws:secretsmanager:us-east-1:123:secret:key',
        temperature: 0.5,
        topP: 0.8,
        maxTokens: 2048,
      };

      const result = buildHarnessBaseOpts(options, harnessSpec);

      expect(result.model).toEqual({
        openAiModelConfig: {
          modelId: 'gpt-5',
          apiKeyArn: 'arn:aws:secretsmanager:us-east-1:123:secret:key',
          temperature: 0.5,
          topP: 0.8,
          maxTokens: 2048,
        },
      });
    });

    it('gemini: includes temperature, topP, topK, maxTokens, and apiKeyArn', () => {
      const options: InvokeOptions = { modelId: 'gemini-2.5-pro' };
      const harnessSpec = {
        provider: 'gemini' as const,
        modelId: 'gemini-2.5-flash',
        apiKeyArn: 'arn:aws:secretsmanager:us-east-1:123:secret:gemini',
        temperature: 0.3,
        topP: 0.95,
        topK: 0.5,
        maxTokens: 1024,
      };

      const result = buildHarnessBaseOpts(options, harnessSpec);

      expect(result.model).toEqual({
        geminiModelConfig: {
          modelId: 'gemini-2.5-pro',
          apiKeyArn: 'arn:aws:secretsmanager:us-east-1:123:secret:gemini',
          temperature: 0.3,
          topP: 0.95,
          topK: 0.5,
          maxTokens: 1024,
        },
      });
    });
  });

  describe('omits undefined inference params', () => {
    it('bedrock: only includes modelId when no inference params set', () => {
      const options: InvokeOptions = { modelId: 'anthropic.claude-v3' };
      const harnessSpec = { provider: 'bedrock' as const, modelId: 'anthropic.claude-v2' };

      const result = buildHarnessBaseOpts(options, harnessSpec);

      expect(result.model).toEqual({
        bedrockModelConfig: { modelId: 'anthropic.claude-v3' },
      });
    });

    it('open_ai: omits apiKeyArn and inference params when not set', () => {
      const options: InvokeOptions = { modelId: 'gpt-5', modelProvider: 'open_ai' };
      const harnessSpec = { provider: 'open_ai' as const, modelId: 'gpt-4' };

      const result = buildHarnessBaseOpts(options, harnessSpec);

      expect(result.model).toEqual({
        openAiModelConfig: { modelId: 'gpt-5' },
      });
    });
  });

  describe('CLI options take precedence for apiKeyArn', () => {
    it('uses CLI apiKeyArn over harness spec', () => {
      const options: InvokeOptions = {
        modelId: 'gpt-5',
        apiKeyArn: 'arn:aws:secretsmanager:us-east-1:123:secret:cli-key',
      };
      const harnessSpec = {
        provider: 'open_ai' as const,
        modelId: 'gpt-4',
        apiKeyArn: 'arn:aws:secretsmanager:us-east-1:123:secret:spec-key',
        maxTokens: 1000,
      };

      const result = buildHarnessBaseOpts(options, harnessSpec);

      expect(result.model!.openAiModelConfig!.apiKeyArn).toBe('arn:aws:secretsmanager:us-east-1:123:secret:cli-key');
      expect(result.model!.openAiModelConfig!.maxTokens).toBe(1000);
    });
  });

  describe('does not set model when no model override options provided', () => {
    it('returns empty opts when no model-related options are set', () => {
      const options: InvokeOptions = {};
      const harnessSpec = {
        provider: 'bedrock' as const,
        modelId: 'anthropic.claude-v2',
        maxTokens: 500,
      };

      const result = buildHarnessBaseOpts(options, harnessSpec);

      expect(result.model).toBeUndefined();
    });
  });

  describe('harness-level execution limits', () => {
    it('forwards maxTokens, maxIterations, and timeoutSeconds from CLI options', () => {
      const options: InvokeOptions = {
        maxTokens: 100,
        maxIterations: 10,
        harnessTimeout: 30,
      };

      const result = buildHarnessBaseOpts(options);

      expect(result.maxTokens).toBe(100);
      expect(result.maxIterations).toBe(10);
      expect(result.timeoutSeconds).toBe(30);
    });
  });
});
