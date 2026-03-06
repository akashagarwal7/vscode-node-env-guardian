/**
 * Unit tests for EnvFileIndex content parsing.
 *
 * These tests run without the VSCode API — they exercise `parseContent` directly.
 */

import * as assert from 'assert';
import { EnvFileIndex } from '../../src/envFileIndex';

function parseContent(content: string): Set<string> {
  const index = new EnvFileIndex();
  return (index as unknown as { parseContent(c: string): Set<string> }).parseContent(content);
}

suite('EnvFileIndex — parseContent', () => {
  test('parses simple KEY=VALUE lines', () => {
    const vars = parseContent('API_KEY=abc\nDB_URL=postgres://localhost\n');
    assert.ok(vars.has('API_KEY'));
    assert.ok(vars.has('DB_URL'));
    assert.strictEqual(vars.size, 2);
  });

  test('parses empty values (VAR= still counts as defined)', () => {
    const vars = parseContent('EMPTY_VAR=\n');
    assert.ok(vars.has('EMPTY_VAR'));
  });

  test('skips blank lines', () => {
    const vars = parseContent('\nAPI_KEY=val\n\nDB_URL=val\n\n');
    assert.strictEqual(vars.size, 2);
  });

  test('skips comment lines', () => {
    const vars = parseContent('# This is a comment\nAPI_KEY=val\n# Another comment\n');
    assert.ok(vars.has('API_KEY'));
    assert.ok(!vars.has('# This is a comment'));
    assert.strictEqual(vars.size, 1);
  });

  test('skips lines that are not KEY=... format', () => {
    const vars = parseContent('not a valid line\nAPI_KEY=val\n123_INVALID=val\n');
    assert.ok(vars.has('API_KEY'));
    assert.ok(!vars.has('123_INVALID')); // starts with digit — invalid
    assert.strictEqual(vars.size, 1);
  });

  test('handles KEY = VALUE (spaces around =)', () => {
    const vars = parseContent('KEY = value\n');
    assert.ok(vars.has('KEY'));
  });

  test('handles duplicate keys (second definition still counts as defined)', () => {
    const vars = parseContent('FOO=bar\nFOO=baz\n');
    assert.ok(vars.has('FOO'));
    assert.strictEqual(vars.size, 1); // Still just one unique name
  });

  test('handles underscore-prefixed names', () => {
    const vars = parseContent('_PRIVATE=secret\n');
    assert.ok(vars.has('_PRIVATE'));
  });

  test('handles mixed case variable names', () => {
    const vars = parseContent('MyVar=value\nmyVar=value\nMYVAR=value\n');
    assert.ok(vars.has('MyVar'));
    assert.ok(vars.has('myVar'));
    assert.ok(vars.has('MYVAR'));
  });

  test('empty file results in empty set', () => {
    const vars = parseContent('');
    assert.strictEqual(vars.size, 0);
  });

  test('file with only comments results in empty set', () => {
    const vars = parseContent('# comment 1\n# comment 2\n');
    assert.strictEqual(vars.size, 0);
  });

  test('quoted values are parsed (variable name extracted correctly)', () => {
    const vars = parseContent('API_KEY="my-api-key"\nDB_URL=\'postgres://localhost\'\n');
    assert.ok(vars.has('API_KEY'));
    assert.ok(vars.has('DB_URL'));
  });
});
