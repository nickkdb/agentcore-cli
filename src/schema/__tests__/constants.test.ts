import { DEFAULT_PYTHON_VERSION, PythonRuntimeSchema } from '../constants.js';
import { describe, expect, it } from 'vitest';

describe('schema/constants', () => {
  describe('DEFAULT_PYTHON_VERSION', () => {
    // Issue #907: PYTHON_3_14 is rejected by CloudFormation in many regions,
    // so the default must be a server-side-supported version.
    it('defaults to PYTHON_3_13', () => {
      expect(DEFAULT_PYTHON_VERSION).toBe('PYTHON_3_13');
    });

    it('is a valid member of PythonRuntimeSchema', () => {
      expect(PythonRuntimeSchema.safeParse(DEFAULT_PYTHON_VERSION).success).toBe(true);
    });
  });
});
