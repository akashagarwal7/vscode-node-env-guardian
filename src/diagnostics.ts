import * as vscode from 'vscode';
import * as path from 'path';
import { ProcessEnvUsageScanner } from './scanner';
import { EnvFileIndex } from './envFileIndex';
import { isEnvFilePath, debounce, getConfig } from './utils';

const SOURCE_NAME = 'EnvGuardian';

/**
 * Provides inline warning/info diagnostics for process.env.* references
 * in source files, based on whether the variable exists in .env* files.
 */
export class EnvDiagnosticsProvider implements vscode.Disposable {
  private collection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly scanner: ProcessEnvUsageScanner,
    private readonly envIndex: EnvFileIndex
  ) {
    this.collection = vscode.languages.createDiagnosticCollection(SOURCE_NAME);

    this.registerListeners();
  }

  // ── Listener Setup ───────────────────────────────────────────────────────────

  private registerListeners(): void {
    const debouncedSingleDoc = debounce(
      (doc: vscode.TextDocument) => this.refreshForDocument(doc),
      500
    );

    // Source file opened
    vscode.workspace.onDidOpenTextDocument(
      doc => {
        if (this.isSourceFile(doc)) {
          this.refreshForDocument(doc);
        }
      },
      null,
      this.disposables
    );

    // Source file edited (debounced)
    vscode.workspace.onDidChangeTextDocument(
      event => {
        if (this.isSourceFile(event.document)) {
          debouncedSingleDoc(event.document);
        }
      },
      null,
      this.disposables
    );

    // Any .env* file saved → recompute all open source files
    vscode.workspace.onDidSaveTextDocument(
      doc => {
        if (isEnvFilePath(doc.uri.fsPath)) {
          this.refreshAllOpenSourceFiles();
        } else if (this.isSourceFile(doc)) {
          this.refreshForDocument(doc);
        }
      },
      null,
      this.disposables
    );

    // Source file closed → clear its diagnostics
    vscode.workspace.onDidCloseTextDocument(
      doc => {
        this.collection.delete(doc.uri);
      },
      null,
      this.disposables
    );

    // Scanner or env index changed → refresh all open source files
    this.scanner.onDidChange(
      () => this.refreshAllOpenSourceFiles(),
      null,
      this.disposables
    );
    this.envIndex.onDidChange(
      () => this.refreshAllOpenSourceFiles(),
      null,
      this.disposables
    );
  }

  // ── Computation ──────────────────────────────────────────────────────────────

  refreshForDocument(document: vscode.TextDocument): void {
    if (!getConfig<boolean>('diagnostics.enabled', true)) {
      this.collection.delete(document.uri);
      return;
    }

    const diagnostics = this.getDiagnostics(document);
    this.collection.set(document.uri, diagnostics);
  }

  refreshAllOpenSourceFiles(): void {
    for (const doc of vscode.workspace.textDocuments) {
      if (this.isSourceFile(doc)) {
        this.refreshForDocument(doc);
      }
    }
  }

  getDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const usages = this.scanner.getUsagesForFile(document.uri.fsPath);
    const allEnvFiles = this.envIndex.getAllFiles();

    const partialWarningsEnabled = getConfig<boolean>('diagnostics.partialWarnings', true);

    for (const usage of usages) {
      const definedInFiles: string[] = [];
      const missingFromFiles: string[] = [];

      for (const [filePath, vars] of allEnvFiles.entries()) {
        if (vars.has(usage.variableName)) {
          definedInFiles.push(filePath);
        } else {
          missingFromFiles.push(filePath);
        }
      }

      const totalEnvFiles = allEnvFiles.size;
      const definedCount = definedInFiles.length;

      const range = new vscode.Range(
        usage.line,
        usage.column,
        usage.line,
        usage.columnEnd
      );

      if (definedCount === 0) {
        // Not defined in any .env file
        const diag = new vscode.Diagnostic(
          range,
          `"${usage.variableName}" is not defined in any .env file`,
          vscode.DiagnosticSeverity.Warning
        );
        diag.source = SOURCE_NAME;
        diag.code = 'env-missing';
        diagnostics.push(diag);
      } else if (partialWarningsEnabled && definedCount < totalEnvFiles) {
        // Defined in some but not all .env files
        const missingNames = missingFromFiles.map(f => path.basename(f));
        const diag = new vscode.Diagnostic(
          range,
          `"${usage.variableName}" is missing from: ${missingNames.join(', ')}`,
          vscode.DiagnosticSeverity.Information
        );
        diag.source = SOURCE_NAME;
        diag.code = 'env-partial';
        diagnostics.push(diag);
      }
    }

    return diagnostics;
  }

  // ── Code Actions ──────────────────────────────────────────────────────────────

  createCodeActionProvider(): vscode.CodeActionProvider {
    return {
      provideCodeActions: (
        document: vscode.TextDocument,
        _range: vscode.Range,
        context: vscode.CodeActionContext
      ): vscode.CodeAction[] => {
        const actions: vscode.CodeAction[] = [];

        for (const diag of context.diagnostics) {
          if (diag.source !== SOURCE_NAME) {
            continue;
          }

          // Extract variable name from the message: "VAR_NAME" is not defined...
          const varMatch = /^"([^"]+)"/.exec(diag.message);
          if (!varMatch) {
            continue;
          }
          const varName = varMatch[1];

          if (diag.code === 'env-missing' || diag.code === 'env-partial') {
            // "Add to .env file" (opens QuickPick)
            const addToOne = new vscode.CodeAction(
              `Add "${varName}" to .env file…`,
              vscode.CodeActionKind.QuickFix
            );
            addToOne.command = {
              command: 'envGuardian.addMissingVarFromDiag',
              title: `Add "${varName}" to .env file`,
              arguments: [varName, false],
            };
            addToOne.diagnostics = [diag];
            actions.push(addToOne);

            // "Add to all .env files"
            const addToAll = new vscode.CodeAction(
              `Add "${varName}" to all .env files`,
              vscode.CodeActionKind.QuickFix
            );
            addToAll.command = {
              command: 'envGuardian.addMissingVarFromDiag',
              title: `Add "${varName}" to all .env files`,
              arguments: [varName, true],
            };
            addToAll.diagnostics = [diag];
            actions.push(addToAll);
          }
        }

        return actions;
      },
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private isSourceFile(document: vscode.TextDocument): boolean {
    const ext = path.extname(document.uri.fsPath).slice(1);
    return ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'mts', 'cts'].includes(ext);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  dispose(): void {
    this.collection.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
