import * as path from 'path';
import * as fs from 'fs';
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

export const ENVIGNORE_FILENAME = '.node-env-guardian-ignore';

export const DEFAULT_EXCLUDE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/coverage/**',
  '**/.git/**',
];

/**
 * Read .envignore from the workspace root and return glob patterns.
 * If the file doesn't exist, returns undefined (caller should fall back to defaults).
 * Lines starting with # and blank lines are ignored.
 */
export function readEnvIgnore(workspaceRoot: string): string[] | undefined {
  const ignorePath = path.join(workspaceRoot, ENVIGNORE_FILENAME);
  try {
    const content = fs.readFileSync(ignorePath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch {
    return undefined;
  }
}

/**
 * Returns the effective exclude globs for scanning.
 * Priority: .envignore file > envGuardian.excludeGlobs setting > hardcoded defaults.
 */
export function getExcludeGlobs(): string[] {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    const fromFile = readEnvIgnore(workspaceRoot);
    if (fromFile) {
      return fromFile;
    }
  }
  return getConfig<string[]>('excludeGlobs', DEFAULT_EXCLUDE_GLOBS);
}
