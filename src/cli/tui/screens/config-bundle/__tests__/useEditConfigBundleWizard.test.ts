import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import React, { act } from 'react';
import {
  useEditConfigBundleWizard,
  EDIT_STEP_LABELS,
} from '../useEditConfigBundleWizard.js';
import type {
  EditConfigBundleStep,
  EditConfigBundleConfig,
} from '../useEditConfigBundleWizard.js';

// ---------------------------------------------------------------------------
// Helpers – a thin wrapper component that exposes hook state via a ref
// ---------------------------------------------------------------------------

interface HookRef {
  config: EditConfigBundleConfig;
  step: EditConfigBundleStep;
  steps: EditConfigBundleStep[];
  currentIndex: number;
  goBack: () => void;
  selectBundle: (name: string) => void;
  setInputMethod: (method: 'inline' | 'file') => void;
  setComponents: (components: Record<string, unknown>, raw: string) => void;
  setCommitMessage: (msg: string) => void;
  setBranchName: (name: string) => void;
  reset: () => void;
}

function HookWrapper({ hookRef }: { hookRef: { current: HookRef | null } }) {
  const hook = useEditConfigBundleWizard();
  hookRef.current = hook as unknown as HookRef;
  return null;
}

const ALL_STEPS: EditConfigBundleStep[] = [
  'selectBundle',
  'inputMethod',
  'components',
  'commitMessage',
  'branchName',
  'confirm',
];

const DEFAULT_CONFIG: EditConfigBundleConfig = {
  bundleName: '',
  inputMethod: 'inline',
  components: {},
  componentsRaw: '',
  commitMessage: '',
  branchName: '',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useEditConfigBundleWizard', () => {
  let hookRef: { current: HookRef | null };

  beforeEach(() => {
    hookRef = { current: null };
    render(React.createElement(HookWrapper, { hookRef }));
  });

  afterEach(() => {
    cleanup();
  });

  // 1 – Initial state
  describe('initial state', () => {
    it('should start on the selectBundle step', () => {
      expect(hookRef.current!.step).toBe('selectBundle');
    });

    it('should have default config values', () => {
      expect(hookRef.current!.config).toEqual(DEFAULT_CONFIG);
    });

    it('should have currentIndex of 0', () => {
      expect(hookRef.current!.currentIndex).toBe(0);
    });
  });

  // 10 – steps array matches ALL_STEPS
  describe('steps', () => {
    it('should return all steps in the correct order', () => {
      expect(hookRef.current!.steps).toEqual(ALL_STEPS);
    });
  });

  // 2 – selectBundle advances to inputMethod
  describe('selectBundle', () => {
    it('should set bundleName and advance to inputMethod', () => {
      act(() => {
        hookRef.current!.selectBundle('my-bundle');
      });

      expect(hookRef.current!.config.bundleName).toBe('my-bundle');
      expect(hookRef.current!.step).toBe('inputMethod');
      expect(hookRef.current!.currentIndex).toBe(1);
    });
  });

  // 3 – setInputMethod advances to components
  describe('setInputMethod', () => {
    it('should set inputMethod and advance to components', () => {
      act(() => {
        hookRef.current!.selectBundle('my-bundle');
      });
      act(() => {
        hookRef.current!.setInputMethod('file');
      });

      expect(hookRef.current!.config.inputMethod).toBe('file');
      expect(hookRef.current!.step).toBe('components');
      expect(hookRef.current!.currentIndex).toBe(2);
    });
  });

  // 4 – setComponents advances to commitMessage
  describe('setComponents', () => {
    it('should set components and componentsRaw and advance to commitMessage', () => {
      act(() => {
        hookRef.current!.selectBundle('my-bundle');
      });
      act(() => {
        hookRef.current!.setInputMethod('inline');
      });

      const components = { guardrail: { version: '1.0' } };
      const raw = '{"guardrail":{"version":"1.0"}}';

      act(() => {
        hookRef.current!.setComponents(components, raw);
      });

      expect(hookRef.current!.config.components).toEqual(components);
      expect(hookRef.current!.config.componentsRaw).toBe(raw);
      expect(hookRef.current!.step).toBe('commitMessage');
      expect(hookRef.current!.currentIndex).toBe(3);
    });
  });

  // 5 – setCommitMessage advances to branchName
  describe('setCommitMessage', () => {
    it('should set commitMessage and advance to branchName', () => {
      act(() => {
        hookRef.current!.selectBundle('b');
      });
      act(() => {
        hookRef.current!.setInputMethod('inline');
      });
      act(() => {
        hookRef.current!.setComponents({}, '{}');
      });
      act(() => {
        hookRef.current!.setCommitMessage('update config');
      });

      expect(hookRef.current!.config.commitMessage).toBe('update config');
      expect(hookRef.current!.step).toBe('branchName');
      expect(hookRef.current!.currentIndex).toBe(4);
    });
  });

  // 6 – setBranchName advances to confirm
  describe('setBranchName', () => {
    it('should set branchName and advance to confirm', () => {
      act(() => {
        hookRef.current!.selectBundle('b');
      });
      act(() => {
        hookRef.current!.setInputMethod('inline');
      });
      act(() => {
        hookRef.current!.setComponents({}, '{}');
      });
      act(() => {
        hookRef.current!.setCommitMessage('msg');
      });
      act(() => {
        hookRef.current!.setBranchName('feature/edit');
      });

      expect(hookRef.current!.config.branchName).toBe('feature/edit');
      expect(hookRef.current!.step).toBe('confirm');
      expect(hookRef.current!.currentIndex).toBe(5);
    });
  });

  // 7 – goBack moves to previous step
  describe('goBack', () => {
    it('should move from inputMethod back to selectBundle', () => {
      act(() => {
        hookRef.current!.selectBundle('b');
      });

      expect(hookRef.current!.step).toBe('inputMethod');

      act(() => {
        hookRef.current!.goBack();
      });

      expect(hookRef.current!.step).toBe('selectBundle');
      expect(hookRef.current!.currentIndex).toBe(0);
    });

    it('should move from components back to inputMethod', () => {
      act(() => {
        hookRef.current!.selectBundle('b');
      });
      act(() => {
        hookRef.current!.setInputMethod('inline');
      });

      expect(hookRef.current!.step).toBe('components');

      act(() => {
        hookRef.current!.goBack();
      });

      expect(hookRef.current!.step).toBe('inputMethod');
      expect(hookRef.current!.currentIndex).toBe(1);
    });
  });

  // 8 – goBack does nothing on first step
  describe('goBack on first step', () => {
    it('should remain on selectBundle when goBack is called at the start', () => {
      act(() => {
        hookRef.current!.goBack();
      });

      expect(hookRef.current!.step).toBe('selectBundle');
      expect(hookRef.current!.currentIndex).toBe(0);
    });
  });

  // 9 – reset returns to initial state
  describe('reset', () => {
    it('should return to initial state after progressing through steps', () => {
      act(() => {
        hookRef.current!.selectBundle('b');
      });
      act(() => {
        hookRef.current!.setInputMethod('file');
      });
      act(() => {
        hookRef.current!.setComponents({ x: { v: '1' } }, '{"x":{"v":"1"}}');
      });

      expect(hookRef.current!.step).toBe('commitMessage');
      expect(hookRef.current!.config.bundleName).toBe('b');

      act(() => {
        hookRef.current!.reset();
      });

      expect(hookRef.current!.step).toBe('selectBundle');
      expect(hookRef.current!.currentIndex).toBe(0);
      expect(hookRef.current!.config).toEqual(DEFAULT_CONFIG);
    });
  });

  // 11 – currentIndex tracks step position throughout the wizard
  describe('currentIndex', () => {
    it('should track step position as the wizard progresses', () => {
      expect(hookRef.current!.currentIndex).toBe(0);

      act(() => {
        hookRef.current!.selectBundle('b');
      });
      expect(hookRef.current!.currentIndex).toBe(1);

      act(() => {
        hookRef.current!.setInputMethod('inline');
      });
      expect(hookRef.current!.currentIndex).toBe(2);

      act(() => {
        hookRef.current!.setComponents({}, '{}');
      });
      expect(hookRef.current!.currentIndex).toBe(3);

      act(() => {
        hookRef.current!.setCommitMessage('m');
      });
      expect(hookRef.current!.currentIndex).toBe(4);

      act(() => {
        hookRef.current!.setBranchName('br');
      });
      expect(hookRef.current!.currentIndex).toBe(5);
    });
  });
});

// ---------------------------------------------------------------------------
// EDIT_STEP_LABELS – exported constant
// ---------------------------------------------------------------------------

describe('EDIT_STEP_LABELS', () => {
  it('should have a label for every step', () => {
    for (const step of ALL_STEPS) {
      expect(EDIT_STEP_LABELS[step]).toBeDefined();
      expect(typeof EDIT_STEP_LABELS[step]).toBe('string');
    }
  });

  it('should map steps to the expected labels', () => {
    expect(EDIT_STEP_LABELS).toEqual({
      selectBundle: 'Bundle',
      inputMethod: 'Input',
      components: 'Components',
      commitMessage: 'Message',
      branchName: 'Branch',
      confirm: 'Confirm',
    });
  });
});
