import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadProjectConfig = vi.fn();
const mockGetWorkingDirectory = vi.fn().mockReturnValue('/fake/project');
const mockFindConfigRoot = vi.fn().mockReturnValue('/fake/project');
const mockStartOtelCollector = vi.fn().mockResolvedValue({ collector: {}, otelEnvVars: {} });
const mockRunWebUI = vi.fn().mockResolvedValue(undefined);
const mockLoadDevEnv = vi.fn().mockResolvedValue({ envVars: {} });
const mockGetDevSupportedAgents = vi.fn().mockReturnValue([]);
const mockIsPreviewEnabled = vi.fn();
const mockRunCliDeploy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../../lib', () => ({
  findConfigRoot: (...args: unknown[]) => mockFindConfigRoot(...args),
  getWorkingDirectory: () => mockGetWorkingDirectory(),
  ConfigIO: class MockConfigIO {
    configExists = vi.fn().mockReturnValue(false);
  },
}));

vi.mock('../../../feature-flags', () => ({
  isPreviewEnabled: () => mockIsPreviewEnabled(),
}));

vi.mock('../../../operations/dev', () => ({
  loadProjectConfig: (...args: unknown[]) => mockLoadProjectConfig(...args),
  getDevConfig: vi.fn(),
  getDevSupportedAgents: (...args: unknown[]) => mockGetDevSupportedAgents(...args),
  loadDevEnv: (...args: unknown[]) => mockLoadDevEnv(...args),
}));

vi.mock('../../../operations/dev/otel', () => ({
  startOtelCollector: (...args: unknown[]) => mockStartOtelCollector(...args),
}));

vi.mock('../../../operations/dev/web-ui', () => ({
  runWebUI: (...args: unknown[]) => mockRunWebUI(...args),
}));

vi.mock('../../../operations/memory', () => ({
  listMemoryRecords: vi.fn(),
  retrieveMemoryRecords: vi.fn(),
}));

vi.mock('../../../operations/resolve-agent', () => ({
  loadDeployedProjectConfig: vi.fn(),
  resolveAgentOrHarness: vi.fn(),
}));

vi.mock('../../../operations/traces', () => ({
  fetchTraceRecords: vi.fn(),
  listTraces: vi.fn(),
}));

vi.mock('../../deploy/progress', () => ({
  runCliDeploy: (...args: unknown[]) => mockRunCliDeploy(...args),
}));

vi.mock('../../../tui/context', () => ({
  LayoutProvider: ({ children }: { children: unknown }) => children,
}));

const mockRender = vi.fn();
vi.mock('ink', () => ({
  render: (...args: unknown[]) => mockRender(...args),
}));

vi.mock('react', () => ({
  default: { createElement: vi.fn((_type, _props, ..._children) => ({ type: _type, props: _props })) },
  createElement: vi.fn((_type, _props, ..._children) => ({ type: _type, props: _props })),
}));

const mockStdoutWrite = vi.fn();

describe('launchBrowserDev', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStdoutWrite.mockReturnValue(true);
    vi.spyOn(process.stdout, 'write').mockImplementation(mockStdoutWrite);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('when preview is enabled and project has harnesses', () => {
    it('uses TUI picker with alt screen for deploy instead of inline runCliDeploy', async () => {
      const { launchBrowserDev } = await import('../browser-mode');

      mockIsPreviewEnabled.mockReturnValue(true);
      mockLoadProjectConfig.mockResolvedValue({
        runtimes: [{ name: 'my-agent', build: 'CodeZip', protocol: 'HTTP' }],
        harnesses: [{ name: 'my-harness' }],
      });
      mockGetDevSupportedAgents.mockReturnValue([{ name: 'my-agent', build: 'CodeZip', protocol: 'HTTP' }]);

      mockRender.mockImplementation((element: { props: Record<string, unknown> }) => {
        const onLaunchBrowser = element.props?.onLaunchBrowser as
          | ((selection?: { agentName?: string; harnessName?: string }) => void)
          | undefined;
        if (onLaunchBrowser) {
          onLaunchBrowser({ agentName: 'my-agent', harnessName: 'my-harness' });
        }
        return { unmount: vi.fn(), waitUntilExit: () => Promise.resolve() };
      });

      await launchBrowserDev();

      // Verify alt screen was entered (TUI picker path)
      expect(mockStdoutWrite).toHaveBeenCalledWith('\x1B[?1049h\x1B[H');
      // Verify render was called (DevScreen TUI was used)
      expect(mockRender).toHaveBeenCalled();
      // Verify runCliDeploy was NOT called (deploy handled by TUI picker)
      expect(mockRunCliDeploy).not.toHaveBeenCalled();
    });

    it('does not proceed to browser mode when user backs out of TUI picker', async () => {
      const { launchBrowserDev } = await import('../browser-mode');

      mockIsPreviewEnabled.mockReturnValue(true);
      mockLoadProjectConfig.mockResolvedValue({
        runtimes: [{ name: 'my-agent', build: 'CodeZip', protocol: 'HTTP' }],
        harnesses: [{ name: 'my-harness' }],
      });
      mockGetDevSupportedAgents.mockReturnValue([{ name: 'my-agent', build: 'CodeZip', protocol: 'HTTP' }]);

      mockRender.mockImplementation((element: { props: Record<string, unknown> }) => {
        const onBack = element.props?.onBack as (() => void) | undefined;
        if (onBack) onBack();
        return { unmount: vi.fn(), waitUntilExit: () => Promise.resolve() };
      });

      await launchBrowserDev();

      expect(mockStdoutWrite).toHaveBeenCalledWith('\x1B[?1049h\x1B[H');
      expect(mockStdoutWrite).toHaveBeenCalledWith('\x1B[?1049l');
      expect(mockRunWebUI).not.toHaveBeenCalled();
      expect(mockRunCliDeploy).not.toHaveBeenCalled();
    });
  });

  describe('when preview is disabled', () => {
    it('skips harnesses and launches browser mode directly without TUI picker', async () => {
      const { launchBrowserDev } = await import('../browser-mode');

      mockIsPreviewEnabled.mockReturnValue(false);
      mockLoadProjectConfig.mockResolvedValue({
        runtimes: [{ name: 'my-agent', build: 'CodeZip', protocol: 'HTTP' }],
        harnesses: [{ name: 'my-harness' }],
      });
      mockGetDevSupportedAgents.mockReturnValue([{ name: 'my-agent', build: 'CodeZip', protocol: 'HTTP' }]);

      await launchBrowserDev();

      // Should NOT enter alt screen or use TUI picker
      expect(mockStdoutWrite).not.toHaveBeenCalledWith('\x1B[?1049h\x1B[H');
      expect(mockRender).not.toHaveBeenCalled();
      // Should go straight to browser mode
      expect(mockRunWebUI).toHaveBeenCalled();
    });
  });

  describe('error cases', () => {
    it('exits when no project is found', async () => {
      const { launchBrowserDev } = await import('../browser-mode');
      mockIsPreviewEnabled.mockReturnValue(true);
      mockLoadProjectConfig.mockResolvedValue(null);

      await expect(launchBrowserDev()).rejects.toThrow('process.exit called');
    });

    it('exits when project has no runtimes or harnesses', async () => {
      const { launchBrowserDev } = await import('../browser-mode');
      mockIsPreviewEnabled.mockReturnValue(true);
      mockLoadProjectConfig.mockResolvedValue({
        runtimes: [],
        harnesses: [],
      });

      await expect(launchBrowserDev()).rejects.toThrow('process.exit called');
    });
  });
});
