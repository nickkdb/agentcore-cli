// ─────────────────────────────────────────────────────────────────────────────
// AB Test Wizard Types
// ─────────────────────────────────────────────────────────────────────────────

export type AddABTestStep =
  | 'name'
  | 'description'
  | 'gateway'
  | 'variants'
  | 'onlineEval'
  | 'maxDuration'
  | 'enableOnCreate'
  | 'confirm';

export interface AddABTestConfig {
  name: string;
  description: string;
  gateway: string;
  controlBundle: string;
  controlVersion: string;
  treatmentBundle: string;
  treatmentVersion: string;
  treatmentWeight: number;
  onlineEval: string;
  maxDuration: number | undefined;
  enableOnCreate: boolean;
}

export const AB_TEST_STEP_LABELS: Record<AddABTestStep, string> = {
  name: 'Name',
  description: 'Description',
  gateway: 'Gateway',
  variants: 'Variants',
  onlineEval: 'Eval',
  maxDuration: 'Duration',
  enableOnCreate: 'Enable',
  confirm: 'Confirm',
};
