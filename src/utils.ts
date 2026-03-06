import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Returns true if the given URI points to a .env* file.
 */
export function isEnvFile(uri: vscode.Uri): boolean {
  const basename = path.basename(uri.fsPath);
  return /^\.env/.test(basename);
}

/**
 * Returns true if the given file path points to a .env* file.
 */
export function isEnvFilePath(filePath: string): boolean {
  const basename = path.basename(filePath);
  return /^\.env/.test(basename);
}

/**
 * Debounce: returns a function that delays invoking `fn` until `delay` ms
 * have elapsed since the last call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, delay);
  };
}

/**
 * Returns the display name for a source location summary.
 * e.g. "src/api/client.ts:14"
 */
export function formatUsageLocation(filePath: string, line: number, workspaceRoot?: string): string {
  let displayPath = filePath;
  if (workspaceRoot && filePath.startsWith(workspaceRoot)) {
    displayPath = filePath.slice(workspaceRoot.length).replace(/^[\\/]/, '');
  }
  return `${displayPath}:${line + 1}`;
}

/**
 * Returns the workspace root folder for the given file path, if any.
 */
export function getWorkspaceFolderForFile(filePath: string): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
}

/**
 * Returns configuration value with a typed default fallback.
 */
export function getConfig<T>(key: string, defaultValue: T): T {
  const config = vscode.workspace.getConfiguration('envGuardian');
  return config.get<T>(key, defaultValue);
}
