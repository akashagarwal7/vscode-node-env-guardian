import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { MissingVarItem, MissingVarsProvider } from './missingVarsProvider';
import { ProcessEnvUsageScanner, EnvUsage } from './scanner';
import { EnvFileIndex } from './envFileIndex';
import { isEnvFile } from './utils';

const execFileAsync = promisify(execFile);

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
            'Node Env Guardian: No .env file is currently active. Focus a .env file first.'
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

  // ── envGuardian.encryptSecrets ───────────────────────────────────────────────
  disposables.push(
    vscode.commands.registerCommand('envGuardian.encryptSecrets', async () => {
      const filePath = provider.getActiveEnvFilePath();
      if (!filePath) {
        vscode.window.showErrorMessage('Node Env Guardian: No .env file is currently tracked.');
        return;
      }

      if (isFileEncrypted(filePath)) {
        const keyPath = getDefaultKeyPath(filePath);
        vscode.window.showInformationMessage(
          `Already encrypted. Key: ${keyPath}`
        );
        return;
      }

      if (!(await ensureDotenvx(filePath))) {
        return;
      }

      const defaultKeyPath = getDefaultKeyPath(filePath);
      const keyPath = await vscode.window.showInputBox({
        prompt: 'Path to store the encryption key file',
        value: defaultKeyPath,
        ignoreFocusOut: true,
      });
      if (!keyPath) {
        return;
      }

      const keyDir = path.dirname(keyPath);
      await fs.promises.mkdir(keyDir, { recursive: true });

      try {
        const cwd = path.dirname(filePath);
        await execFileAsync('npx', ['dotenvx', 'encrypt', '-f', filePath, '-fk', keyPath], { cwd });
        vscode.window.showInformationMessage(
          `Encrypted ${path.basename(filePath)}. Key: ${keyPath}`
        );
        provider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Encryption failed: ${err.stderr || err.message}`
        );
      }
    })
  );

  // ── envGuardian.decryptSecrets ───────────────────────────────────────────────
  disposables.push(
    vscode.commands.registerCommand('envGuardian.decryptSecrets', async () => {
      const filePath = provider.getActiveEnvFilePath();
      if (!filePath) {
        vscode.window.showErrorMessage('Node Env Guardian: No .env file is currently tracked.');
        return;
      }

      if (!isFileEncrypted(filePath)) {
        vscode.window.showInformationMessage('File is not encrypted.');
        return;
      }

      if (!(await ensureDotenvx(filePath))) {
        return;
      }

      let keyPath = getDefaultKeyPath(filePath);
      if (!fs.existsSync(keyPath)) {
        const entered = await vscode.window.showInputBox({
          prompt: `Key file not found at ${keyPath}. Enter path to key file:`,
          ignoreFocusOut: true,
        });
        if (!entered) {
          return;
        }
        keyPath = entered;
        if (!fs.existsSync(keyPath)) {
          vscode.window.showErrorMessage(`Key file not found: ${keyPath}`);
          return;
        }
      }

      try {
        const cwd = path.dirname(filePath);
        await execFileAsync('npx', ['dotenvx', 'decrypt', '-f', filePath, '-fk', keyPath], { cwd });
        vscode.window.showInformationMessage(`Decrypted ${path.basename(filePath)}.`);
        provider.refresh();
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Decryption failed: ${err.stderr || err.message}`
        );
      }
    })
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
            'Node Env Guardian: No .env files found in the workspace.'
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

// ── dotenvx Helpers ──────────────────────────────────────────────────────────

/**
 * Check if a .env file contains encrypted values (lines with "encrypted:" prefix in values).
 */
function isFileEncrypted(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').some(line => /^[^#=]+=\s*"?encrypted:/.test(line));
  } catch {
    return false;
  }
}

/**
 * Returns the default key path: ~/.dotenvx-keys/<project-basename>/<env-filename>.key
 */
function getDefaultKeyPath(envFilePath: string): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const projectName = workspaceFolder ? path.basename(workspaceFolder) : 'unknown';
  const envFileName = path.basename(envFilePath);
  return path.join(os.homedir(), '.dotenvx-keys', projectName, `${envFileName}.key`);
}

/**
 * Check if dotenvx is available; if not, offer to install it.
 * Returns true if dotenvx is available (or was just installed).
 */
async function ensureDotenvx(envFilePath: string): Promise<boolean> {
  try {
    await execFileAsync('npx', ['dotenvx', '--version'], {
      cwd: path.dirname(envFilePath),
    });
    return true;
  } catch {
    const choice = await vscode.window.showWarningMessage(
      'dotenvx is not available. Install it as a dev dependency?',
      'Install',
      'Cancel'
    );
    if (choice !== 'Install') {
      return false;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found.');
      return false;
    }

    try {
      await execFileAsync('npm', ['install', '-D', '@dotenvx/dotenvx'], {
        cwd: workspaceFolder,
      });
      vscode.window.showInformationMessage('Installed @dotenvx/dotenvx.');
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `Failed to install dotenvx: ${err.message}`
      );
      return false;
    }
  }
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
      `Node Env Guardian: Could not open file ${uri.fsPath}`
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
      `Node Env Guardian: Failed to write to ${path.basename(uri.fsPath)}`
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
