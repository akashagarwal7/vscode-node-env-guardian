/**
 * Unit tests for MissingVarsProvider — tree structure and last-env-file persistence.
 *
 * These tests run with the vscode-mock and verify that the sidebar
 * shows a two-level tree (variable → usage locations) and continues
 * showing results after focus moves away from a .env file.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { MissingVarsProvider, MissingVarItem, UsageLocationItem } from '../../src/missingVarsProvider';
import { ProcessEnvUsageScanner } from '../../src/scanner';
import { EnvFileIndex } from '../../src/envFileIndex';

/**
 * Create a minimal mock editor for a given file path.
 */
function mockEditor(fsPath: string): vscode.TextEditor {
  return {
    document: {
      uri: vscode.Uri.file(fsPath),
    },
  } as unknown as vscode.TextEditor;
}

/**
 * Build a MissingVarsProvider with stubbed scanner/envIndex.
 * The scanner reports `usedVars` as used, and the envIndex reports
 * `definedVars` as defined for the given env file.
 */
function buildProvider(
  usedVars: string[],
  definedVars: string[],
  envFilePath: string
): MissingVarsProvider {
  const scanner = new ProcessEnvUsageScanner();
  const envIndex = new EnvFileIndex();

  // Stub scanner methods
  (scanner as unknown as Record<string, unknown>).getAllVariableNames = () => usedVars;
  (scanner as unknown as Record<string, unknown>).getUsagesForVariable = (name: string) => [
    { variableName: name, filePath: '/src/app.ts', line: 1, column: 0, columnEnd: 10 },
    { variableName: name, filePath: '/src/config.ts', line: 5, column: 2, columnEnd: 12 },
  ];

  // Stub envIndex methods
  (envIndex as unknown as Record<string, unknown>).getVarsForFile = (path: string) => {
    if (path === envFilePath) {
      return new Set(definedVars);
    }
    return new Set<string>();
  };

  return new MissingVarsProvider(scanner, envIndex);
}

suite('MissingVarsProvider — tree structure', () => {
  const envPath = '/workspace/.env';

  let originalActiveEditor: vscode.TextEditor | undefined;

  setup(() => {
    originalActiveEditor = vscode.window.activeTextEditor;
  });

  teardown(() => {
    (vscode.window as Record<string, unknown>).activeTextEditor = originalActiveEditor;
  });

  test('root children are MissingVarItem instances', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const roots = provider.getChildren();
    assert.strictEqual(roots.length, 1);
    assert.ok(roots[0] instanceof MissingVarItem);
    assert.strictEqual((roots[0] as MissingVarItem).variableName, 'API_KEY');
  });

  test('MissingVarItem has Collapsed state when it has usages', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const roots = provider.getChildren();
    assert.strictEqual(roots[0].collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  });

  test('child nodes are UsageLocationItem instances', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const roots = provider.getChildren();
    const children = provider.getChildren(roots[0]);
    assert.strictEqual(children.length, 2);
    assert.ok(children[0] instanceof UsageLocationItem);
    assert.ok(children[1] instanceof UsageLocationItem);
  });

  test('UsageLocationItem has a command to open the file', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const roots = provider.getChildren();
    const children = provider.getChildren(roots[0]);
    const child = children[0] as UsageLocationItem;
    assert.ok(child.command);
    assert.strictEqual(child.command!.command, 'vscode.open');
  });

  test('UsageLocationItem has no children', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const roots = provider.getChildren();
    const children = provider.getChildren(roots[0]);
    const grandchildren = provider.getChildren(children[0]);
    assert.strictEqual(grandchildren.length, 0);
  });

  test('description shows usage count', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const roots = provider.getChildren();
    assert.strictEqual((roots[0] as MissingVarItem).description, '2 usages');
  });
});

suite('MissingVarsProvider — last env file persistence', () => {
  const envPath = '/workspace/.env';
  const srcPath = '/workspace/src/app.ts';

  let originalActiveEditor: vscode.TextEditor | undefined;
  let editorChangeListeners: Array<(e: vscode.TextEditor | undefined) => void>;

  setup(() => {
    originalActiveEditor = vscode.window.activeTextEditor;
    editorChangeListeners = [];

    const originalOn = vscode.window.onDidChangeActiveTextEditor;
    (vscode.window as Record<string, unknown>).onDidChangeActiveTextEditor = (
      listener: (e: vscode.TextEditor | undefined) => void,
      _thisArg?: unknown,
      disposables?: vscode.Disposable[]
    ) => {
      editorChangeListeners.push(listener);
      return originalOn(listener, _thisArg, disposables);
    };
  });

  teardown(() => {
    (vscode.window as Record<string, unknown>).activeTextEditor = originalActiveEditor;
  });

  test('returns missing vars when an env file is active', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY', 'DB_URL'], ['DB_URL'], envPath);

    const children = provider.getChildren();
    assert.strictEqual(children.length, 1);
    assert.strictEqual((children[0] as MissingVarItem).variableName, 'API_KEY');
  });

  test('returns empty when no env file has ever been focused', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = undefined;
    const provider = buildProvider(['API_KEY'], [], envPath);

    const children = provider.getChildren();
    assert.strictEqual(children.length, 0);
  });

  test('persists results when focus moves from env file to non-env file', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY', 'DB_URL'], ['DB_URL'], envPath);

    let children = provider.getChildren();
    assert.strictEqual(children.length, 1);
    assert.strictEqual((children[0] as MissingVarItem).variableName, 'API_KEY');

    // Simulate switching to a non-env file
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(srcPath);
    for (const listener of editorChangeListeners) {
      listener(mockEditor(srcPath));
    }

    children = provider.getChildren();
    assert.strictEqual(children.length, 1);
    assert.strictEqual((children[0] as MissingVarItem).variableName, 'API_KEY');
  });

  test('getActiveEnvFileName returns basename after switching away', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider([], [], envPath);

    assert.strictEqual(provider.getActiveEnvFileName(), '.env');

    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(srcPath);
    for (const listener of editorChangeListeners) {
      listener(mockEditor(srcPath));
    }

    assert.strictEqual(provider.getActiveEnvFileName(), '.env');
  });

  test('updates tracked file when a different env file is focused', () => {
    const envProdPath = '/workspace/.env.production';

    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envProdPath);
    for (const listener of editorChangeListeners) {
      listener(mockEditor(envProdPath));
    }

    assert.strictEqual(provider.getActiveEnvFileName(), '.env.production');
  });
});
