import type { VariantConfig } from '../VariantConfigForm';
import { useAddABTestWizard } from '../useAddABTestWizard';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import React, { act, useImperativeHandle } from 'react';
import { describe, expect, it } from 'vitest';

// ── Simple harness ─────────────────────────────────────────────────────────

function Harness() {
  const wizard = useAddABTestWizard();
  return (
    <Text>
      step:{wizard.step}
      name:{wizard.config.name}
      treatmentWeight:{wizard.config.treatmentWeight}
      enableOnCreate:{String(wizard.config.enableOnCreate)}
      steps:{wizard.steps.join(',')}
    </Text>
  );
}

// ── Imperative harness ─────────────────────────────────────────────────────

interface HarnessHandle {
  setName: (name: string) => void;
  setDescription: (desc: string) => void;
  setGateway: (gw: string) => void;
  setVariants: (vc: VariantConfig) => void;
  setOnlineEval: (eval_: string) => void;
  setMaxDuration: (days: number | undefined) => void;
  setEnableOnCreate: (enable: boolean) => void;
  goBack: () => void;
  reset: () => void;
}

const ImperativeHarness = React.forwardRef<HarnessHandle>((_, ref) => {
  const wizard = useAddABTestWizard();
  useImperativeHandle(ref, () => ({
    setName: wizard.setName,
    setDescription: wizard.setDescription,
    setGateway: wizard.setGateway,
    setVariants: wizard.setVariants,
    setOnlineEval: wizard.setOnlineEval,
    setMaxDuration: wizard.setMaxDuration,
    setEnableOnCreate: wizard.setEnableOnCreate,
    goBack: wizard.goBack,
    reset: wizard.reset,
  }));
  return (
    <Text>
      step:{wizard.step}
      name:{wizard.config.name}
      description:{wizard.config.description}
      gateway:{wizard.config.gateway}
      controlBundle:{wizard.config.controlBundle}
      treatmentWeight:{wizard.config.treatmentWeight}
      onlineEval:{wizard.config.onlineEval}
      maxDuration:{String(wizard.config.maxDuration ?? 'undefined')}
      enableOnCreate:{String(wizard.config.enableOnCreate)}
    </Text>
  );
});
ImperativeHarness.displayName = 'ImperativeHarness';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useAddABTestWizard', () => {
  describe('defaults', () => {
    it('default step is name', () => {
      const { lastFrame } = render(<Harness />);
      expect(lastFrame()).toContain('step:name');
    });

    it('default treatment weight is 20', () => {
      const { lastFrame } = render(<Harness />);
      expect(lastFrame()).toContain('treatmentWeight:20');
    });

    it('default enableOnCreate is true', () => {
      const { lastFrame } = render(<Harness />);
      expect(lastFrame()).toContain('enableOnCreate:true');
    });

    it('has all 8 steps', () => {
      const { lastFrame } = render(<Harness />);
      const frame = lastFrame()!.replace(/\n/g, '');
      expect(frame).toContain('steps:name,description,gateway,variants,onlineEval,maxDuration,enableOnCreate,confirm');
    });
  });

  describe('step navigation', () => {
    it('setName advances to description', () => {
      const ref = React.createRef<HarnessHandle>();
      const { lastFrame } = render(<ImperativeHarness ref={ref} />);

      act(() => ref.current!.setName('Test1'));

      expect(lastFrame()).toContain('step:description');
      expect(lastFrame()).toContain('name:Test1');
    });

    it('setDescription advances to gateway', () => {
      const ref = React.createRef<HarnessHandle>();
      const { lastFrame } = render(<ImperativeHarness ref={ref} />);

      act(() => ref.current!.setName('Test1'));
      act(() => ref.current!.setDescription('A description'));

      expect(lastFrame()).toContain('step:gateway');
      expect(lastFrame()).toContain('description:A description');
    });

    it('setGateway advances to variants', () => {
      const ref = React.createRef<HarnessHandle>();
      const { lastFrame } = render(<ImperativeHarness ref={ref} />);

      act(() => ref.current!.setName('T'));
      act(() => ref.current!.setDescription(''));
      act(() => ref.current!.setGateway('arn:gateway'));

      expect(lastFrame()).toContain('step:variants');
      expect(lastFrame()).toContain('gateway:arn:gateway');
    });

    it('setVariants advances to onlineEval', () => {
      const ref = React.createRef<HarnessHandle>();
      const { lastFrame } = render(<ImperativeHarness ref={ref} />);

      act(() => ref.current!.setName('T'));
      act(() => ref.current!.setDescription(''));
      act(() => ref.current!.setGateway('gw'));
      act(() =>
        ref.current!.setVariants({
          controlBundle: 'cb',
          controlVersion: 'v1',
          treatmentBundle: 'tb',
          treatmentVersion: 'v2',
          treatmentWeight: 30,
        })
      );

      expect(lastFrame()).toContain('step:onlineEval');
      expect(lastFrame()).toContain('controlBundle:cb');
      expect(lastFrame()).toContain('treatmentWeight:30');
    });

    it('full wizard reaches confirm step', () => {
      const ref = React.createRef<HarnessHandle>();
      const { lastFrame } = render(<ImperativeHarness ref={ref} />);

      act(() => ref.current!.setName('T'));
      act(() => ref.current!.setDescription(''));
      act(() => ref.current!.setGateway('gw'));
      act(() =>
        ref.current!.setVariants({
          controlBundle: 'cb',
          controlVersion: 'v1',
          treatmentBundle: 'tb',
          treatmentVersion: 'v2',
          treatmentWeight: 25,
        })
      );
      act(() => ref.current!.setOnlineEval('eval-arn'));
      act(() => ref.current!.setMaxDuration(30));
      act(() => ref.current!.setEnableOnCreate(false));

      const frame = lastFrame()!.replace(/\n/g, '');
      expect(frame).toContain('step:confirm');
      expect(frame).toContain('enableOnCreate:false');
      expect(frame).toContain('maxDuration:30');
    });
  });

  describe('goBack', () => {
    it('goes back from description to name', () => {
      const ref = React.createRef<HarnessHandle>();
      const { lastFrame } = render(<ImperativeHarness ref={ref} />);

      act(() => ref.current!.setName('T'));
      expect(lastFrame()).toContain('step:description');

      act(() => ref.current!.goBack());
      expect(lastFrame()).toContain('step:name');
    });

    it('does not go back from first step', () => {
      const ref = React.createRef<HarnessHandle>();
      const { lastFrame } = render(<ImperativeHarness ref={ref} />);

      act(() => ref.current!.goBack());
      expect(lastFrame()).toContain('step:name');
    });
  });

  describe('reset', () => {
    it('resets to initial state', () => {
      const ref = React.createRef<HarnessHandle>();
      const { lastFrame } = render(<ImperativeHarness ref={ref} />);

      act(() => ref.current!.setName('Test1'));
      act(() => ref.current!.setDescription('desc'));
      expect(lastFrame()).toContain('step:gateway');

      act(() => ref.current!.reset());

      expect(lastFrame()).toContain('step:name');
      expect(lastFrame()).toContain('name:');
      expect(lastFrame()).toContain('treatmentWeight:20');
    });
  });
});
