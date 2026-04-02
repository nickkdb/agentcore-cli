import { ConfigBundlePrimitive } from '../ConfigBundlePrimitive.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadProjectSpec = vi.fn();
const mockWriteProjectSpec = vi.fn();

vi.mock('../../../lib/index.js', () => ({
  ConfigIO: class {
    readProjectSpec = mockReadProjectSpec;
    writeProjectSpec = mockWriteProjectSpec;
  },
  findConfigRoot: () => '/fake/root',
}));

function makeProject(
  configBundles: Array<{
    type: string;
    name: string;
    description?: string;
    components: Record<string, { configuration: Record<string, unknown> }>;
    branchName?: string;
    commitMessage?: string;
  }> = [],
) {
  return {
    name: 'TestProject',
    version: 1,
    managedBy: 'CDK' as const,
    runtimes: [],
    memories: [],
    credentials: [],
    evaluators: [],
    onlineEvalConfigs: [],
    configBundles,
  };
}

const primitive = new ConfigBundlePrimitive();

describe('ConfigBundlePrimitive', () => {
  afterEach(() => vi.clearAllMocks());

  describe('edit', () => {
    it('should successfully update components on an existing bundle', async () => {
      const project = makeProject([
        {
          type: 'config-bundle',
          name: 'my-bundle',
          description: 'original description',
          components: { 'arn:old': { configuration: { key: 'old-value' } } },
        },
      ]);
      mockReadProjectSpec.mockResolvedValue(project);
      mockWriteProjectSpec.mockResolvedValue(undefined);

      const newComponents = { 'arn:new': { configuration: { key: 'new-value' } } };
      const result = await primitive.edit({
        bundleName: 'my-bundle',
        components: newComponents,
      });

      expect(result).toEqual({ success: true, bundleName: 'my-bundle' });
      expect(mockWriteProjectSpec).toHaveBeenCalledTimes(1);

      const written = mockWriteProjectSpec.mock.calls[0]![0];
      expect(written.configBundles[0].components).toEqual(newComponents);
      expect(written.configBundles[0].description).toBe('original description');
    });

    it('should update description when provided', async () => {
      const project = makeProject([
        {
          type: 'config-bundle',
          name: 'my-bundle',
          description: 'old desc',
          components: { 'arn:a': { configuration: { x: 1 } } },
        },
      ]);
      mockReadProjectSpec.mockResolvedValue(project);
      mockWriteProjectSpec.mockResolvedValue(undefined);

      const result = await primitive.edit({
        bundleName: 'my-bundle',
        components: { 'arn:a': { configuration: { x: 2 } } },
        description: 'new desc',
      });

      expect(result).toEqual({ success: true, bundleName: 'my-bundle' });

      const written = mockWriteProjectSpec.mock.calls[0]![0];
      expect(written.configBundles[0].description).toBe('new desc');
    });

    it('should update branchName and commitMessage when provided', async () => {
      const project = makeProject([
        {
          type: 'config-bundle',
          name: 'my-bundle',
          components: { 'arn:a': { configuration: {} } },
        },
      ]);
      mockReadProjectSpec.mockResolvedValue(project);
      mockWriteProjectSpec.mockResolvedValue(undefined);

      const result = await primitive.edit({
        bundleName: 'my-bundle',
        components: { 'arn:b': { configuration: { y: 1 } } },
        branchName: 'feature-branch',
        commitMessage: 'update config',
      });

      expect(result).toEqual({ success: true, bundleName: 'my-bundle' });

      const written = mockWriteProjectSpec.mock.calls[0]![0];
      expect(written.configBundles[0].branchName).toBe('feature-branch');
      expect(written.configBundles[0].commitMessage).toBe('update config');
    });

    it('should return error when bundle name is not found', async () => {
      const project = makeProject([
        {
          type: 'config-bundle',
          name: 'existing-bundle',
          components: { 'arn:a': { configuration: {} } },
        },
      ]);
      mockReadProjectSpec.mockResolvedValue(project);

      const result = await primitive.edit({
        bundleName: 'nonexistent-bundle',
        components: { 'arn:x': { configuration: {} } },
      });

      expect(result).toEqual({
        success: false,
        error: 'Configuration bundle "nonexistent-bundle" not found.',
      });
      expect(mockWriteProjectSpec).not.toHaveBeenCalled();
    });

    it('should preserve existing fields like type and name', async () => {
      const project = makeProject([
        {
          type: 'config-bundle',
          name: 'my-bundle',
          description: 'keep this',
          components: { 'arn:old': { configuration: { a: 1 } } },
          branchName: 'main',
          commitMessage: 'initial',
        },
      ]);
      mockReadProjectSpec.mockResolvedValue(project);
      mockWriteProjectSpec.mockResolvedValue(undefined);

      await primitive.edit({
        bundleName: 'my-bundle',
        components: { 'arn:updated': { configuration: { b: 2 } } },
      });

      const written = mockWriteProjectSpec.mock.calls[0]![0];
      const bundle = written.configBundles[0];
      expect(bundle.type).toBe('config-bundle');
      expect(bundle.name).toBe('my-bundle');
      expect(bundle.description).toBe('keep this');
      expect(bundle.branchName).toBe('main');
      expect(bundle.commitMessage).toBe('initial');
      expect(bundle.components).toEqual({ 'arn:updated': { configuration: { b: 2 } } });
    });

    it('should not overwrite existing description when description is undefined', async () => {
      const project = makeProject([
        {
          type: 'config-bundle',
          name: 'my-bundle',
          description: 'should remain',
          components: { 'arn:a': { configuration: {} } },
        },
      ]);
      mockReadProjectSpec.mockResolvedValue(project);
      mockWriteProjectSpec.mockResolvedValue(undefined);

      await primitive.edit({
        bundleName: 'my-bundle',
        components: { 'arn:b': { configuration: {} } },
        // description intentionally omitted
      });

      const written = mockWriteProjectSpec.mock.calls[0]![0];
      expect(written.configBundles[0].description).toBe('should remain');
    });

    it('should return error when readProjectSpec throws', async () => {
      mockReadProjectSpec.mockRejectedValue(new Error('File not found'));

      const result = await primitive.edit({
        bundleName: 'my-bundle',
        components: { 'arn:a': { configuration: {} } },
      });

      expect(result).toEqual({ success: false, error: 'File not found' });
      expect(mockWriteProjectSpec).not.toHaveBeenCalled();
    });
  });
});
