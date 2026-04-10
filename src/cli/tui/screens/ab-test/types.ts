// ─────────────────────────────────────────────────────────────────────────────
// AB Test Wizard Types
// ─────────────────────────────────────────────────────────────────────────────

export type AddABTestStep =
  | 'name'
  | 'description'
  | 'agent'
  | 'gateway'
  | 'variants'
  | 'onlineEval'
  | 'maxDuration'
  | 'enableOnCreate'
  | 'confirm';

export type GatewayChoice = { type: 'create-new' } | { type: 'existing-http'; name: string };

export interface AddABTestConfig {
  name: string;
  description: string;
  agent: string;
  gatewayChoice: GatewayChoice;
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
  agent: 'Agent',
  gateway: 'Gateway',
  variants: 'Variants',
  onlineEval: 'Eval',
  maxDuration: 'Duration',
  enableOnCreate: 'Enable',
  confirm: 'Confirm',
};
