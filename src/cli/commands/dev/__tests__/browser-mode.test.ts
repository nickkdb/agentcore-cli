import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadProjectConfig = vi.fn();
const mockGetWorkingDirectory = vi.fn().mockReturnValue('/fake/project');
const mockFindConfigRoot = vi.fn().mockReturnValue('/fake/project');
const mockStartOtelCollector = vi.fn().mockResolvedValue({ collector: {}, otelEnvVars: {} });
const mockRunWebUI = vi.fn().mockResolvedValue(undefined);
const mockLoadDevEnv = vi.fn().mockResolvedValue({ envVars: {} });
const mockGetDevSupportedAgents = vi.fn().mockReturnValue([]);

vi.mock('../../../../lib', () => ({
  findConfigRoot: (...args: unknown[]) => mockFindConfigRoot(...args),
  getWorkingDirectory: () => mockGetWorkingDirectory(),
  ConfigIO: class MockConfigIO {
    configExists = vi.fn().mockReturnValue(false);
  },
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

  it('uses TUI picker with alt screen for deploy instead of inline runCliDeploy', async () => {
    const { launchBrowserDev } = await import('../browser-mode');

    mockLoadProjectConfig.mockResolvedValue({
      runtimes: [{ name: 'my-agent', build: 'CodeZip', protocol: 'HTTP' }],
      harnesses: [{ name: 'my-harness' }],
    });
    mockGetDevSupportedAgents.mockReturnValue([{ name: 'my-agent', build: 'CodeZip', protocol: 'HTTP' }]);

    let onLaunchBrowserCb: ((selection?: { agentName?: string; harnessName?: string }) => void) | undefined;
    const mockUnmount = vi.fn();
    mockRender.mockImplementation((element: { props: Record<string, unknown> }) => {
      // Capture the onLaunchBrowser callback from DevScreen props
      onLaunchBrowserCb = element.props?.onLaunchBrowser as typeof onLaunchBrowserCb;
      // Simulate the TUI immediately selecting and calling onLaunchBrowser
      if (onLaunchBrowserCb) {
        onLaunchBrowserCb({ agentName: 'my-agent', harnessName: 'my-harness' });
      }
      return { unmount: mockUnmount, waitUntilExit: () => Promise.resolve() };
    });

    await launchBrowserDev();

    // Verify alt screen was entered (TUI picker path)
    expect(mockStdoutWrite).toHaveBeenCalledWith('\x1B[?1049h\x1B[H');
    // Verify render was called (DevScreen TUI was used)
    expect(mockRender).toHaveBeenCalled();
  });

  it('does not proceed to browser mode when user backs out of TUI picker', async () => {
    const { launchBrowserDev } = await import('../browser-mode');

    mockLoadProjectConfig.mockResolvedValue({
      runtimes: [{ name: 'my-agent', build: 'CodeZip', protocol: 'HTTP' }],
      harnesses: [{ name: 'my-harness' }],
    });
    mockGetDevSupportedAgents.mockReturnValue([{ name: 'my-agent', build: 'CodeZip', protocol: 'HTTP' }]);

    const mockUnmount = vi.fn();
    mockRender.mockImplementation((element: { props: Record<string, unknown> }) => {
      // Simulate user pressing back
      const onBack = element.props?.onBack as (() => void) | undefined;
      if (onBack) onBack();
      return { unmount: mockUnmount, waitUntilExit: () => Promise.resolve() };
    });

    await launchBrowserDev();

    // Alt screen was entered and exited
    expect(mockStdoutWrite).toHaveBeenCalledWith('\x1B[?1049h\x1B[H');
    expect(mockStdoutWrite).toHaveBeenCalledWith('\x1B[?1049l');
    // Web UI should NOT be launched
    expect(mockRunWebUI).not.toHaveBeenCalled();
  });

  it('exits when no project is found', async () => {
    const { launchBrowserDev } = await import('../browser-mode');
    mockLoadProjectConfig.mockResolvedValue(null);

    await expect(launchBrowserDev()).rejects.toThrow('process.exit called');
  });

  it('exits when project has no runtimes or harnesses', async () => {
    const { launchBrowserDev } = await import('../browser-mode');

    mockLoadProjectConfig.mockResolvedValue({
      runtimes: [],
      harnesses: [],
    });

    await expect(launchBrowserDev()).rejects.toThrow('process.exit called');
  });
});
