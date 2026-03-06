import * as vscode from 'vscode';
import { ProcessEnvUsageScanner } from './scanner';
import { EnvFileIndex } from './envFileIndex';
import { MissingVarsProvider } from './missingVarsProvider';
import { EnvDiagnosticsProvider } from './diagnostics';
import { registerCommands } from './commands';

// Singletons held for the lifetime of the extension
let scanner: ProcessEnvUsageScanner | undefined;
let envIndex: EnvFileIndex | undefined;
let missingVarsProvider: MissingVarsProvider | undefined;
let diagnosticsProvider: EnvDiagnosticsProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 1. Initialise the usage scanner
  scanner = new ProcessEnvUsageScanner();

  // 2. Initialise the env file index
  envIndex = new EnvFileIndex();

  // 3. Register the MissingVarsProvider as a TreeDataProvider
  missingVarsProvider = new MissingVarsProvider(scanner, envIndex);
  const treeView = vscode.window.createTreeView('envGuardian.missingVars', {
    treeDataProvider: missingVarsProvider,
    showCollapseAll: false,
  });

  // Update the tree view title to show how many missing vars exist
  missingVarsProvider.onDidChangeTreeData(() => {
    const items = missingVarsProvider!.getChildren();
    const count = items.length;
    const activeFile = missingVarsProvider!.getActiveEnvFileName();
    if (activeFile && count > 0) {
      treeView.title = `Missing Variables (${count})`;
    } else {
      treeView.title = 'Missing Variables';
    }
  });

  // 4. Initialise the diagnostics provider
  diagnosticsProvider = new EnvDiagnosticsProvider(scanner, envIndex);

  // Register code action provider for Quick Fix on env diagnostics
  const codeActionProvider = diagnosticsProvider.createCodeActionProvider();
  const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
    [
      { scheme: 'file', language: 'javascript' },
      { scheme: 'file', language: 'typescript' },
      { scheme: 'file', language: 'javascriptreact' },
      { scheme: 'file', language: 'typescriptreact' },
    ],
    codeActionProvider,
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }
  );

  // 5. Register all commands
  const commandDisposables = registerCommands(
    context,
    scanner,
    envIndex,
    missingVarsProvider
  );

  // 6. Push all disposables
  context.subscriptions.push(
    scanner,
    envIndex,
    missingVarsProvider,
    diagnosticsProvider,
    treeView,
    codeActionDisposable,
    ...commandDisposables
  );

  // 7. Kick off the initial scans (after registering everything so events propagate correctly)
  await Promise.all([scanner.initialize(), envIndex.initialize()]);

  // 8. Compute initial diagnostics for any already-open documents
  diagnosticsProvider.refreshAllOpenSourceFiles();
}

export function deactivate(): void {
  // All disposables are cleaned up via context.subscriptions above.
  // Explicit disposal here in case deactivate is called before context cleanup.
  scanner?.dispose();
  envIndex?.dispose();
  missingVarsProvider?.dispose();
  diagnosticsProvider?.dispose();

  scanner = undefined;
  envIndex = undefined;
  missingVarsProvider = undefined;
  diagnosticsProvider = undefined;
}
