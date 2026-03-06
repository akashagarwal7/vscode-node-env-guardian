/**
 * Unit tests for ProcessEnvUsageScanner regex parsing.
 *
 * These tests run without the VSCode API — they exercise `parseUsages` directly.
 */

import * as assert from 'assert';
import { ProcessEnvUsageScanner } from '../../src/scanner';

function parseUsages(filePath: string, content: string) {
  const scanner = new ProcessEnvUsageScanner();
  return (scanner as unknown as { parseUsages(f: string, c: string): unknown[] }).parseUsages(
    filePath,
    content
  );
}

suite('ProcessEnvUsageScanner — parseUsages', () => {
  test('dot access: process.env.VAR_NAME', () => {
    const usages = parseUsages('/src/a.ts', 'const x = process.env.API_KEY;') as Array<{
      variableName: string;
      line: number;
      column: number;
    }>;
    assert.strictEqual(usages.length, 1);
    assert.strictEqual(usages[0].variableName, 'API_KEY');
    assert.strictEqual(usages[0].line, 0);
    assert.strictEqual(usages[0].column, 10); // starts at "process"
  });

  test('bracket access with single quotes', () => {
    const usages = parseUsages('/src/b.ts', "const x = process.env['REDIS_HOST'];") as Array<{
      variableName: string;
    }>;
    assert.strictEqual(usages.length, 1);
    assert.strictEqual(usages[0].variableName, 'REDIS_HOST');
  });

  test('bracket access with double quotes', () => {
    const usages = parseUsages('/src/c.ts', 'const x = process.env["SENDGRID_KEY"];') as Array<{
      variableName: string;
    }>;
    assert.strictEqual(usages.length, 1);
    assert.strictEqual(usages[0].variableName, 'SENDGRID_KEY');
  });

  test('bracket access with spaces around quotes', () => {
    const usages = parseUsages(
      '/src/d.ts',
      "const x = process.env[ 'DB_URL' ];"
    ) as Array<{ variableName: string }>;
    assert.strictEqual(usages.length, 1);
    assert.strictEqual(usages[0].variableName, 'DB_URL');
  });

  test('dynamic access is ignored', () => {
    const usages = parseUsages('/src/e.ts', "const v = 'KEY'; const x = process.env[v];");
    assert.strictEqual(usages.length, 0);
  });

  test('multiple usages in one file', () => {
    const content = `
const a = process.env.A;
const b = process.env['B'];
const c = process.env["C"];
    `.trim();
    const usages = parseUsages('/src/f.ts', content) as Array<{ variableName: string }>;
    assert.strictEqual(usages.length, 3);
    const names = usages.map(u => u.variableName).sort();
    assert.deepStrictEqual(names, ['A', 'B', 'C']);
  });

  test('line and column are correct for multi-line file', () => {
    const content = 'const x = 1;\nconst y = process.env.MY_VAR;';
    const usages = parseUsages('/src/g.ts', content) as Array<{
      variableName: string;
      line: number;
      column: number;
    }>;
    assert.strictEqual(usages.length, 1);
    assert.strictEqual(usages[0].variableName, 'MY_VAR');
    assert.strictEqual(usages[0].line, 1);
    assert.strictEqual(usages[0].column, 10);
  });

  test('same variable used multiple times is returned multiple times', () => {
    const content = `
const a = process.env.FOO;
const b = process.env.FOO;
    `.trim();
    const usages = parseUsages('/src/h.ts', content) as Array<{ variableName: string }>;
    assert.strictEqual(usages.length, 2);
    assert.ok(usages.every(u => u.variableName === 'FOO'));
  });

  test('variable names starting with underscore are matched', () => {
    const usages = parseUsages('/src/i.ts', 'process.env._PRIVATE') as Array<{
      variableName: string;
    }>;
    assert.strictEqual(usages.length, 1);
    assert.strictEqual(usages[0].variableName, '_PRIVATE');
  });

  test('empty file returns no usages', () => {
    const usages = parseUsages('/src/empty.ts', '');
    assert.strictEqual(usages.length, 0);
  });

  test('file with no process.env refs returns no usages', () => {
    const usages = parseUsages('/src/no-env.ts', 'const x = 1 + 2;\nconsole.log(x);');
    assert.strictEqual(usages.length, 0);
  });
});
