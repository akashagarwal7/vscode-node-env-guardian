import * as vscode from 'vscode';
import * as path from 'path';
import { MissingVarItem, MissingVarsProvider } from './missingVarsProvider';
import { ProcessEnvUsageScanner, EnvUsage } from './scanner';
import { EnvFileIndex } from './envFileIndex';
import { isEnvFile } from './utils';

/**
 * Register all EnvGuardian commands and return their disposables.
 */
export function registerCommands(
  context: vscode.ExtensionContext,
  scanner: ProcessEnvUsageScanner,
  envIndex: EnvFileIndex,
  provider: MissingVarsProvider
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // ── envGuardian.refresh ───────────────────────────────────────────────────────
  disposables.push(
    vscode.commands.registerCommand('envGuardian.refresh', () => {
      provider.refresh();
    })
  );

  // ── envGuardian.copyVarName ───────────────────────────────────────────────────
  disposables.push(
    vscode.commands.registerCommand(
      'envGuardian.copyVarName',
      async (item: MissingVarItem) => {
        if (!item?.variableName) {
          return;
        }
        await vscode.env.clipboard.writeText(item.variableName);
        vscode.window.showInformationMessage(
          `Copied "${item.variableName}" to clipboard.`
        );
      }
    )
  );

  // ── envGuardian.addToEnvFile ──────────────────────────────────────────────────
  disposables.push(
    vscode.commands.registerCommand(
      'envGuardian.addToEnvFile',
      async (item: MissingVarItem) => {
        if (!item?.variableName) {
          return;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || !isEnvFile(activeEditor.document.uri)) {
          vscode.window.showErrorMessage(
            'EnvGuardian: No .env file is currently active. Focus a .env file first.'
          );
          return;
        }

        await appendVarToFile(item.variableName, activeEditor.document.uri);
      }
    )
  );

  // ── envGuardian.goToUsage ─────────────────────────────────────────────────────
  disposables.push(
    vscode.commands.registerCommand(
      'envGuardian.goToUsage',
      async (item: MissingVarItem) => {
        if (!item?.variableName) {
          return;
        }

        const usages = scanner.getUsagesForVariable(item.variableName);
        if (usages.length === 0) {
          vscode.window.showInformationMessage(
            `No usages found for "${item.variableName}".`
          );
          return;
        }

        const targetUsage = await pickUsage(item.variableName, usages);
        if (!targetUsage) {
          return;
        }

        await navigateToUsage(targetUsage);
      }
    )
  );

  // ── envGuardian.addMissingVarFromDiag ─────────────────────────────────────────
  // Internal command triggered from Quick Fix code actions in diagnostics.ts
  disposables.push(
    vscode.commands.registerCommand(
      'envGuardian.addMissingVarFromDiag',
      async (varName: string, addToAll: boolean) => {
        if (!varName) {
          return;
        }

        const envFiles = envIndex.getFilePaths();
        if (envFiles.length === 0) {
          vscode.window.showWarningMessage(
            'EnvGuardian: No .env files found in the workspace.'
          );
          return;
        }

        if (addToAll) {
          // Add to every .env file that's missing it
          for (const filePath of envFiles) {
            const vars = envIndex.getVarsForFile(filePath);
            if (!vars.has(varName)) {
              await appendVarToFile(varName, vscode.Uri.file(filePath));
            }
          }
          vscode.window.showInformationMessage(
            `Added "${varName}=" to all .env files.`
          );
        } else {
          // Show QuickPick to let user choose which file
          const picks = envFiles.map(fp => ({
            label: path.basename(fp),
            description: fp,
            filePath: fp,
          }));

          const chosen = await vscode.window.showQuickPick(picks, {
            placeHolder: `Select a .env file to add "${varName}=" to`,
          });

          if (!chosen) {
            return;
          }

          await appendVarToFile(varName, vscode.Uri.file(chosen.filePath));
          vscode.window.showInformationMessage(
            `Added "${varName}=" to ${chosen.label}.`
          );
        }
      }
    )
  );

  return disposables;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Appends `VAR_NAME=\n` at the end of a .env file using a WorkspaceEdit,
 * then saves the document.
 */
async function appendVarToFile(
  varName: string,
  uri: vscode.Uri
): Promise<void> {
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    vscode.window.showErrorMessage(
      `EnvGuardian: Could not open file ${uri.fsPath}`
    );
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  const lastLine = doc.lineAt(doc.lineCount - 1);

  // If the file doesn't end with a newline, prepend one
  const text = doc.getText();
  const prefix = text.length > 0 && !text.endsWith('\n') ? '\n' : '';
  const insertion = `${prefix}${varName}=\n`;

  edit.insert(uri, lastLine.range.end, insertion);

  const success = await vscode.workspace.applyEdit(edit);
  if (success) {
    await doc.save();
  } else {
    vscode.window.showErrorMessage(
      `EnvGuardian: Failed to write to ${path.basename(uri.fsPath)}`
    );
  }
}

/**
 * If there are multiple usages, show a QuickPick for the user to choose.
 * If there's only one, return it directly.
 */
async function pickUsage(
  varName: string,
  usages: EnvUsage[]
): Promise<EnvUsage | undefined> {
  if (usages.length === 1) {
    return usages[0];
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const picks = usages.map((u, i) => {
    let displayPath = u.filePath;
    if (workspaceRoot && u.filePath.startsWith(workspaceRoot)) {
      displayPath = u.filePath.slice(workspaceRoot.length).replace(/^[\\/]/, '');
    }
    return {
      label: `${displayPath}:${u.line + 1}:${u.column + 1}`,
      description: `Usage ${i + 1} of ${usages.length}`,
      usage: u,
    };
  });

  const chosen = await vscode.window.showQuickPick(picks, {
    placeHolder: `Select usage of "${varName}" to navigate to`,
  });

  return chosen?.usage;
}

/**
 * Opens a source file and moves the cursor to the usage location.
 */
async function navigateToUsage(usage: EnvUsage): Promise<void> {
  const uri = vscode.Uri.file(usage.filePath);
  const position = new vscode.Position(usage.line, usage.column);
  const range = new vscode.Range(position, position);

  await vscode.window.showTextDocument(uri, {
    selection: range,
    preserveFocus: false,
  });
}
