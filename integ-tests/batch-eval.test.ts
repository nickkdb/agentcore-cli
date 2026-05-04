import {
  type TestProject,
  createTestProject,
  parseJsonOutput,
  readProjectConfig,
  runCLI,
  runSuccess,
} from '../src/test-utils/index.js';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('integration: batch evaluation CLI validation', () => {
  let project: TestProject;

  beforeAll(async () => {
    project = await createTestProject({
      language: 'Python',
      framework: 'Strands',
      modelProvider: 'Bedrock',
      memory: 'none',
    });
  });

  afterAll(async () => {
    await project.cleanup();
  });

  describe('run batch-evaluation requires flags', () => {
    it('requires --runtime', async () => {
      const result = await runCLI(
        ['run', 'batch-evaluation', '--evaluator', 'Builtin.Faithfulness', '--json'],
        project.projectPath
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--runtime');
    });

    it('requires --evaluator', async () => {
      const result = await runCLI(
        ['run', 'batch-evaluation', '--runtime', project.agentName, '--json'],
        project.projectPath
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('--evaluator');
    });
  });

  describe('run eval requires flags', () => {
    it('requires --evaluator for run eval', async () => {
      const result = await runCLI(['run', 'eval', '--runtime', project.agentName, '--json'], project.projectPath);

      expect(result.exitCode).toBe(1);
    });
  });

  describe('evaluator and online-eval config lifecycle for batch eval', () => {
    const evalName = `BatchEval${Date.now().toString().slice(-6)}`;
    const model = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
    const instructions = 'Evaluate the session quality. Context: {context}';

    it('adds evaluator for batch eval tests', async () => {
      const json = await runSuccess(
        [
          'add',
          'evaluator',
          '--name',
          evalName,
          '--level',
          'SESSION',
          '--model',
          model,
          '--instructions',
          instructions,
          '--json',
        ],
        project.projectPath
      );
      expect(json.evaluatorName).toBe(evalName);

      const config = await readProjectConfig(project.projectPath);
      const found = config.evaluators.find(e => e.name === evalName);
      expect(found).toBeDefined();
      expect(found!.level).toBe('SESSION');
      expect(found!.config.llmAsAJudge?.model).toBe(model);
    });

    it('adds evaluator with TRACE level', async () => {
      const traceName = `TraceEval${Date.now().toString().slice(-6)}`;
      const json = await runSuccess(
        [
          'add',
          'evaluator',
          '--name',
          traceName,
          '--level',
          'TRACE',
          '--model',
          model,
          '--instructions',
          'Evaluate trace quality. Context: {context}',
          '--json',
        ],
        project.projectPath
      );
      expect(json.evaluatorName).toBe(traceName);

      const config = await readProjectConfig(project.projectPath);
      const found = config.evaluators.find(e => e.name === traceName);
      expect(found).toBeDefined();
      expect(found!.level).toBe('TRACE');
    });

    it('adds evaluator with TOOL_CALL level', async () => {
      const toolName = `ToolEval${Date.now().toString().slice(-6)}`;
      const json = await runSuccess(
        [
          'add',
          'evaluator',
          '--name',
          toolName,
          '--level',
          'TOOL_CALL',
          '--model',
          model,
          '--instructions',
          'Evaluate tool call quality. Context: {context}',
          '--json',
        ],
        project.projectPath
      );
      expect(json.evaluatorName).toBe(toolName);

      const config = await readProjectConfig(project.projectPath);
      const found = config.evaluators.find(e => e.name === toolName);
      expect(found).toBeDefined();
      expect(found!.level).toBe('TOOL_CALL');
    });

    it('adds a code-based evaluator with external lambda', async () => {
      const codeName = `CodeEval${Date.now().toString().slice(-6)}`;
      const json = await runSuccess(
        [
          'add',
          'evaluator',
          '--name',
          codeName,
          '--level',
          'SESSION',
          '--type',
          'code-based',
          '--lambda-arn',
          'arn:aws:lambda:us-east-1:123456789012:function:my-eval',
          '--json',
        ],
        project.projectPath
      );
      expect(json.evaluatorName).toBe(codeName);

      const config = await readProjectConfig(project.projectPath);
      const found = config.evaluators.find(e => e.name === codeName);
      expect(found).toBeDefined();
      expect(found!.config.codeBased?.external?.lambdaArn).toBe(
        'arn:aws:lambda:us-east-1:123456789012:function:my-eval'
      );
    });

    it('adds a managed code-based evaluator', async () => {
      const managedName = `ManagedEval${Date.now().toString().slice(-6)}`;
      const json = await runSuccess(
        ['add', 'evaluator', '--name', managedName, '--level', 'SESSION', '--type', 'code-based', '--json'],
        project.projectPath
      );
      expect(json.evaluatorName).toBe(managedName);
      expect(json.codePath).toBeDefined();

      const config = await readProjectConfig(project.projectPath);
      const found = config.evaluators.find(e => e.name === managedName);
      expect(found).toBeDefined();
      expect(found!.config.codeBased?.managed).toBeDefined();
      expect(found!.config.codeBased?.managed?.codeLocation).toContain(managedName);
    });

    it('adds online eval config with builtin evaluator reference', async () => {
      const configName = `OeBuiltin${Date.now().toString().slice(-6)}`;
      const json = await runSuccess(
        [
          'add',
          'online-eval',
          '--name',
          configName,
          '--runtime',
          project.agentName,
          '--evaluator',
          'Builtin.Faithfulness',
          '--sampling-rate',
          '25',
          '--json',
        ],
        project.projectPath
      );
      expect(json.configName).toBe(configName);

      const config = await readProjectConfig(project.projectPath);
      const found = config.onlineEvalConfigs.find(c => c.name === configName);
      expect(found).toBeDefined();
      expect(found!.evaluators).toContain('Builtin.Faithfulness');
      expect(found!.samplingRate).toBe(25);
    });

    it('adds online eval config with enable-on-create', async () => {
      const configName = `OeEnabled${Date.now().toString().slice(-6)}`;
      const json = await runSuccess(
        [
          'add',
          'online-eval',
          '--name',
          configName,
          '--runtime',
          project.agentName,
          '--evaluator',
          evalName,
          '--sampling-rate',
          '100',
          '--enable-on-create',
          '--json',
        ],
        project.projectPath
      );
      expect(json.configName).toBe(configName);

      const config = await readProjectConfig(project.projectPath);
      const found = config.onlineEvalConfigs.find(c => c.name === configName);
      expect(found).toBeDefined();
      expect(found!.enableOnCreate).toBe(true);
    });

    it('adds online eval config with multiple evaluators', async () => {
      const configName = `OeMulti${Date.now().toString().slice(-6)}`;
      const json = await runSuccess(
        [
          'add',
          'online-eval',
          '--name',
          configName,
          '--runtime',
          project.agentName,
          '--evaluator',
          evalName,
          'Builtin.Correctness',
          '--sampling-rate',
          '50',
          '--json',
        ],
        project.projectPath
      );
      expect(json.configName).toBe(configName);

      const config = await readProjectConfig(project.projectPath);
      const found = config.onlineEvalConfigs.find(c => c.name === configName);
      expect(found).toBeDefined();
      expect(found!.evaluators).toContain(evalName);
      expect(found!.evaluators).toContain('Builtin.Correctness');
    });
  });

  describe('evaluator validation edge cases', () => {
    it('rejects evaluator with invalid level', async () => {
      const result = await runCLI(
        [
          'add',
          'evaluator',
          '--name',
          'BadLevel',
          '--level',
          'INVALID',
          '--model',
          'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
          '--instructions',
          'Test {context}',
          '--json',
        ],
        project.projectPath
      );

      expect(result.exitCode).toBe(1);
      const json = parseJsonOutput(result.stdout) as Record<string, unknown>;
      expect(json.success).toBe(false);
    });

    it('rejects --model with --type code-based', async () => {
      const result = await runCLI(
        [
          'add',
          'evaluator',
          '--name',
          'BadCombo',
          '--level',
          'SESSION',
          '--type',
          'code-based',
          '--model',
          'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
          '--json',
        ],
        project.projectPath
      );

      expect(result.exitCode).toBe(1);
      const json = parseJsonOutput(result.stdout) as Record<string, unknown>;
      expect(json.success).toBe(false);
      expect(json.error).toContain('--model');
    });

    it('rejects --lambda-arn without --type code-based', async () => {
      const result = await runCLI(
        [
          'add',
          'evaluator',
          '--name',
          'BadLambda',
          '--level',
          'SESSION',
          '--lambda-arn',
          'arn:aws:lambda:us-east-1:123456789012:function:fn',
          '--json',
        ],
        project.projectPath
      );

      expect(result.exitCode).toBe(1);
      const json = parseJsonOutput(result.stdout) as Record<string, unknown>;
      expect(json.success).toBe(false);
      expect(json.error).toContain('--lambda-arn');
    });

    it('adds evaluator from config file', async () => {
      const configData = {
        llmAsAJudge: {
          model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
          instructions: 'Evaluate quality. Context: {context}',
          ratingScale: {
            numerical: [
              { value: 1, label: 'Bad', definition: 'Low quality' },
              { value: 5, label: 'Good', definition: 'High quality' },
            ],
          },
        },
      };

      const configPath = join(project.projectPath, 'eval-config.json');
      await writeFile(configPath, JSON.stringify(configData));

      const evalName = `FileEval${Date.now().toString().slice(-6)}`;
      const json = await runSuccess(
        ['add', 'evaluator', '--name', evalName, '--level', 'SESSION', '--config', configPath, '--json'],
        project.projectPath
      );
      expect(json.evaluatorName).toBe(evalName);
    });
  });

  describe('ground truth file parsing', () => {
    let gtDir: string;

    beforeAll(async () => {
      gtDir = join(tmpdir(), `agentcore-integ-gt-${randomUUID()}`);
      await mkdir(gtDir, { recursive: true });
    });

    afterAll(async () => {
      await rm(gtDir, { recursive: true, force: true });
    });

    it('rejects malformed ground truth JSON', async () => {
      const gtPath = join(gtDir, 'bad-gt.json');
      await writeFile(gtPath, 'not valid json');

      const result = await runCLI(
        [
          'run',
          'batch-evaluation',
          '--runtime',
          project.agentName,
          '--evaluator',
          'Builtin.Faithfulness',
          '--ground-truth',
          gtPath,
          '--json',
        ],
        project.projectPath
      );

      expect(result.exitCode).toBe(1);
    });

    it('rejects ground truth file with wrong structure', async () => {
      const gtPath = join(gtDir, 'wrong-structure.json');
      await writeFile(gtPath, JSON.stringify({ notSessionMetadata: 'wrong' }));

      const result = await runCLI(
        [
          'run',
          'batch-evaluation',
          '--runtime',
          project.agentName,
          '--evaluator',
          'Builtin.Faithfulness',
          '--ground-truth',
          gtPath,
          '--json',
        ],
        project.projectPath
      );

      expect(result.exitCode).toBe(1);
    });

    it('accepts valid ground truth file (array format)', async () => {
      const gtData = [
        {
          sessionId: 'test-session-1',
          groundTruth: {
            inline: {
              assertions: [{ text: 'Agent should greet the user' }],
            },
          },
        },
      ];

      const gtPath = join(gtDir, 'valid-gt-array.json');
      await writeFile(gtPath, JSON.stringify(gtData));

      // This will fail because agent is not deployed, but it should parse the GT file successfully
      // and fail later on agent resolution, not on GT parsing
      const result = await runCLI(
        [
          'run',
          'batch-evaluation',
          '--runtime',
          project.agentName,
          '--evaluator',
          'Builtin.Faithfulness',
          '--ground-truth',
          gtPath,
          '--json',
        ],
        project.projectPath
      );

      expect(result.exitCode).toBe(1);
      const json = parseJsonOutput(result.stdout) as Record<string, unknown>;
      // Should fail because agent not deployed, not because of GT parsing
      expect(json.error).toContain('deployed');
    });

    it('accepts valid ground truth file (object format with sessionMetadata key)', async () => {
      const gtData = {
        sessionMetadata: [
          {
            sessionId: 'test-session-2',
            testScenarioId: 'scenario-1',
            groundTruth: {
              inline: {
                expectedTrajectory: { toolNames: ['search', 'summarize'] },
              },
            },
          },
        ],
      };

      const gtPath = join(gtDir, 'valid-gt-object.json');
      await writeFile(gtPath, JSON.stringify(gtData));

      const result = await runCLI(
        [
          'run',
          'batch-evaluation',
          '--runtime',
          project.agentName,
          '--evaluator',
          'Builtin.Faithfulness',
          '--ground-truth',
          gtPath,
          '--json',
        ],
        project.projectPath
      );

      expect(result.exitCode).toBe(1);
      const json = parseJsonOutput(result.stdout) as Record<string, unknown>;
      expect(json.error).toContain('deployed');
    });
  });
});
