import * as path from 'path';
import * as fs from 'fs';

// Use require for modules with tricky typings at this glob/mocha version combo
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Mocha = require('mocha');

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10000,
  });

  const testsRoot = path.resolve(__dirname, '.');

  // Collect test files without glob dependency issues
  const files = fs.readdirSync(testsRoot).filter(f => f.endsWith('.test.js'));
  files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
