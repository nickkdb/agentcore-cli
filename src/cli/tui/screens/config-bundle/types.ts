import type { ComponentConfigurationMap } from '../../../../schema';

// ─────────────────────────────────────────────────────────────────────────────
// Config Bundle Wizard Types
// ─────────────────────────────────────────────────────────────────────────────

export type AddConfigBundleStep =
  | 'name'
  | 'description'
  | 'inputMethod'
  | 'components'
  | 'branchName'
  | 'commitMessage'
  | 'confirm';

export type ComponentInputMethod = 'inline' | 'file';

export interface AddConfigBundleConfig {
  name: string;
  description: string;
  inputMethod: ComponentInputMethod;
  components: ComponentConfigurationMap;
  /** Raw text entered by user (JSON string or file path). */
  componentsRaw: string;
  branchName: string;
  commitMessage: string;
}

export const CONFIG_BUNDLE_STEP_LABELS: Record<AddConfigBundleStep, string> = {
  name: 'Name',
  description: 'Description',
  inputMethod: 'Input',
  components: 'Components',
  branchName: 'Branch',
  commitMessage: 'Message',
  confirm: 'Confirm',
};

export const INPUT_METHOD_OPTIONS = [
  { id: 'inline', title: 'Inline JSON', description: 'Enter component configurations as JSON' },
  { id: 'file', title: 'File path', description: 'Load from a JSON file on disk' },
] as const;
