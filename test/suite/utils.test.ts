/**
 * Unit tests for utility functions.
 */

import * as assert from 'assert';
import { isEnvFile, isEnvFilePath, debounce, formatUsageLocation, readEnvIgnore, DEFAULT_EXCLUDE_GLOBS } from '../../src/utils';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

suite('utils — isEnvFile', () => {
  test('returns true for .env', () => {
    assert.ok(isEnvFile(vscode.Uri.file('/workspace/.env')));
  });

  test('returns true for .env.local', () => {
    assert.ok(isEnvFile(vscode.Uri.file('/workspace/.env.local')));
  });

  test('returns true for .env.production', () => {
    assert.ok(isEnvFile(vscode.Uri.file('/workspace/.env.production')));
  });

  test('returns false for package.json', () => {
    assert.ok(!isEnvFile(vscode.Uri.file('/workspace/package.json')));
  });

  test('returns false for src/app.ts', () => {
    assert.ok(!isEnvFile(vscode.Uri.file('/workspace/src/app.ts')));
  });
});

suite('utils — isEnvFilePath', () => {
  test('returns true for .env path', () => {
    assert.ok(isEnvFilePath('/workspace/.env'));
  });

  test('returns true for .env.test path', () => {
    assert.ok(isEnvFilePath('/workspace/.env.test'));
  });

  test('returns false for regular file', () => {
    assert.ok(!isEnvFilePath('/workspace/src/index.ts'));
  });

  test('returns false for env without dot prefix', () => {
    assert.ok(!isEnvFilePath('/workspace/env'));
  });
});

suite('utils — debounce', () => {
  test('delays execution', (done) => {
    let called = false;
    const fn = debounce(() => { called = true; }, 10);
    fn();
    assert.ok(!called);
    setTimeout(() => {
      assert.ok(called);
      done();
    }, 50);
  });

  test('only fires once for rapid calls', (done) => {
    let count = 0;
    const fn = debounce(() => { count++; }, 10);
    fn();
    fn();
    fn();
    setTimeout(() => {
      assert.strictEqual(count, 1);
      done();
    }, 50);
  });

  test('passes arguments through', (done) => {
    let result = '';
    const fn = debounce((val: string) => { result = val; }, 10);
    fn('hello');
    setTimeout(() => {
      assert.strictEqual(result, 'hello');
      done();
    }, 50);
  });
});

suite('utils — formatUsageLocation', () => {
  test('formats with workspace root stripping', () => {
    const result = formatUsageLocation('/workspace/src/app.ts', 9, '/workspace');
    assert.strictEqual(result, 'src/app.ts:10');
  });

  test('formats without workspace root', () => {
    const result = formatUsageLocation('/workspace/src/app.ts', 0);
    assert.strictEqual(result, '/workspace/src/app.ts:1');
  });

  test('line is 1-indexed in output', () => {
    const result = formatUsageLocation('/src/a.ts', 0);
    assert.strictEqual(result, '/src/a.ts:1');
  });
});

suite('utils — readEnvIgnore', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-guardian-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns undefined when file does not exist', () => {
    const result = readEnvIgnore(tmpDir);
    assert.strictEqual(result, undefined);
  });

  test('parses patterns from ignore file', () => {
    fs.writeFileSync(path.join(tmpDir, '.node-env-guardian-ignore'), '**/node_modules/**\n**/dist/**\n');
    const result = readEnvIgnore(tmpDir);
    assert.deepStrictEqual(result, ['**/node_modules/**', '**/dist/**']);
  });

  test('skips comments and blank lines', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.node-env-guardian-ignore'),
      '# comment\n\n**/dist/**\n  \n# another comment\n**/build/**\n'
    );
    const result = readEnvIgnore(tmpDir);
    assert.deepStrictEqual(result, ['**/dist/**', '**/build/**']);
  });

  test('trims whitespace from patterns', () => {
    fs.writeFileSync(path.join(tmpDir, '.node-env-guardian-ignore'), '  **/dist/**  \n');
    const result = readEnvIgnore(tmpDir);
    assert.deepStrictEqual(result, ['**/dist/**']);
  });
});

suite('utils — DEFAULT_EXCLUDE_GLOBS', () => {
  test('contains expected default patterns', () => {
    assert.ok(DEFAULT_EXCLUDE_GLOBS.includes('**/node_modules/**'));
    assert.ok(DEFAULT_EXCLUDE_GLOBS.includes('**/dist/**'));
    assert.ok(DEFAULT_EXCLUDE_GLOBS.includes('**/build/**'));
  });
});
