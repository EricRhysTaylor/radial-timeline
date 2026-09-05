import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STATUS_HEX } from './constants';

// APR (PNG / standalone SVG) reads STATUS_HEX directly; the timeline reads CSS vars from
// variables.css. If those diverge, the social APR export drifts from the live timeline.
// This test pins them together.
describe('STATUS_HEX vs variables.css', () => {
  const variablesCss = readFileSync(
    resolve(__dirname, '../styles/variables.css'),
    'utf8'
  );

  // Complete is intentionally omitted — completed scenes get their fill from the publish stage
  // color (see resolveSceneColor), not from --rt-color-complete, so no CSS var is defined.
  const expectations: Array<[keyof typeof STATUS_HEX, string]> = [
    ['Working', '--rt-color-working'],
    ['Todo', '--rt-color-todo'],
    ['Empty', '--rt-color-empty'],
    ['Due', '--rt-color-due'],
  ];

  for (const [statusKey, cssVarName] of expectations) {
    it(`STATUS_HEX.${statusKey} matches ${cssVarName} in variables.css`, () => {
      const re = new RegExp(`${cssVarName}\\s*:\\s*(#[0-9a-fA-F]{3,8})\\s*;`);
      const match = variablesCss.match(re);
      expect(match, `${cssVarName} not found as a hex value in variables.css`).toBeTruthy();
      expect(match![1].toLowerCase()).toBe(STATUS_HEX[statusKey].toLowerCase());
    });
  }
});
