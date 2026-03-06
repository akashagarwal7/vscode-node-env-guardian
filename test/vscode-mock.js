'use strict';
/**
 * Minimal VSCode API mock for running unit tests outside VSCode.
 * Only stubs what scanner.ts, envFileIndex.ts, and utils.ts need at import time.
 */

const vscode = {
  workspace: {
    findFiles: async () => [],
    fs: { readFile: async () => Buffer.from('') },
    createFileSystemWatcher: () => ({
      onDidCreate: () => ({ dispose: () => {} }),
      onDidChange: () => ({ dispose: () => {} }),
      onDidDelete: () => ({ dispose: () => {} }),
      dispose: () => {},
    }),
    onDidSaveTextDocument: () => ({ dispose: () => {} }),
    onDidOpenTextDocument: () => ({ dispose: () => {} }),
    onDidChangeTextDocument: () => ({ dispose: () => {} }),
    onDidCloseTextDocument: () => ({ dispose: () => {} }),
    textDocuments: [],
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    getWorkspaceFolder: () => undefined,
    getConfiguration: () => ({ get: (_key, def) => def }),
    applyEdit: async () => true,
    openTextDocument: async () => ({}),
  },
  window: {
    activeTextEditor: undefined,
    onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
    withProgress: async (_opts, fn) => fn(),
    showInformationMessage: () => {},
    showErrorMessage: () => {},
    showWarningMessage: () => {},
    showQuickPick: async () => undefined,
    createTreeView: () => ({ title: '', dispose: () => {} }),
  },
  languages: {
    createDiagnosticCollection: () => ({
      set: () => {},
      delete: () => {},
      dispose: () => {},
    }),
    registerCodeActionsProvider: () => ({ dispose: () => {} }),
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
  },
  env: {
    clipboard: { writeText: async () => {} },
  },
  Uri: {
    file: (p) => ({ fsPath: p, scheme: 'file' }),
  },
  EventEmitter: class {
    constructor() { this._listeners = []; }
    get event() {
      return (listener, _thisArg, disposables) => {
        this._listeners.push(listener);
        const d = { dispose: () => { this._listeners = this._listeners.filter(l => l !== listener); } };
        if (disposables) disposables.push(d);
        return d;
      };
    }
    fire(data) { this._listeners.forEach(l => l(data)); }
    dispose() { this._listeners = []; }
  },
  ProgressLocation: { Window: 10 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  ThemeIcon: class {
    constructor(id) { this.id = id; }
  },
  DiagnosticSeverity: { Warning: 1, Information: 2, Error: 0, Hint: 3 },
  Diagnostic: class {
    constructor(range, message, severity) {
      this.range = range;
      this.message = message;
      this.severity = severity;
    }
  },
  Range: class {
    constructor(startLine, startChar, endLine, endChar) {
      this.start = { line: startLine, character: startChar };
      this.end = { line: endLine, character: endChar };
    }
  },
  Position: class {
    constructor(line, character) { this.line = line; this.character = character; }
  },
  CodeActionKind: { QuickFix: 'quickfix' },
  CodeAction: class {
    constructor(title, kind) { this.title = title; this.kind = kind; }
  },
};

// Register the mock so require('vscode') works
require.cache[require.resolve ? 'vscode' : 'vscode'] = undefined;
// Node module resolution trick: add a fake entry to the module cache
const Module = require('module');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'vscode') return 'vscode';
  return originalResolve.call(this, request, ...args);
};
require.cache['vscode'] = {
  id: 'vscode',
  filename: 'vscode',
  loaded: true,
  exports: vscode,
  parent: null,
  children: [],
  paths: [],
};
