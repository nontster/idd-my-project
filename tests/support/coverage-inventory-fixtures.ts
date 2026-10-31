import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

export const projectRoot = resolve(__dirname, '../../..');

export function coverageFixture(coverAll: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'api-key-engineering-'));
  mkdirSync(join(root, 'src/services'), { recursive: true });
  mkdirSync(join(root, 'build/src/services'), { recursive: true });
  mkdirSync(join(root, 'build/tests'), { recursive: true });
  symlinkSync(join(projectRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
  cpSync(join(projectRoot, 'jest.config.cjs'), join(root, 'jest.config.cjs'));
  cpSync(join(projectRoot, 'scripts'), join(root, 'scripts'), { recursive: true });
  cpSync(join(projectRoot, 'package.json'), join(root, 'package.json'));
  cpSync(join(projectRoot, '.nvmrc'), join(root, '.nvmrc'));
  writeFileSync(join(root, 'tsconfig.test.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2023', module: 'CommonJS', rootDir: '.', outDir: 'build', noEmitOnError: true,
    sourceMap: false, skipLibCheck: true,
  }, include: ['src/**/*.ts'] }));
  for (const name of ['authentication', 'revocation']) {
    writeFileSync(join(root, `src/services/${name}.ts`), `export function decide(allowed: boolean) { if (allowed) return 1; return 0; }\n`);
    writeFileSync(join(root, `build/src/services/${name}.js`), `exports.decide = function(allowed) { if (allowed) return 1; return 0; };\n`);
  }
  const subjects = coverAll ? ['authentication', 'revocation'] : ['authentication'];
  writeFileSync(join(root, 'build/tests/fixture.test.js'), subjects.map(name =>
    `test('${name} observable decision', () => { const {decide}=require('../src/services/${name}.js'); expect(decide(true)).toBe(1); ${coverAll ? 'expect(decide(false)).toBe(0);' : ''} });`
  ).join('\n'));
  return {
    root,
    runJest: () => spawnSync(process.execPath, [join(projectRoot, 'node_modules/jest/bin/jest.js'),
      '--config', join(root, 'jest.config.cjs'), '--runInBand', '--coverage', '--coverageReporters=json',
      '--json', '--outputFile', join(root, 'coverage/test-results.json')], { cwd: root, encoding: 'utf8' }),
    runGate: () => spawnSync(process.execPath, [join(projectRoot, 'scripts/check-security-coverage.cjs'), root], { encoding: 'utf8' }),
    readCoverage: () => JSON.parse(readFileSync(join(root, 'coverage/coverage-final.json'), 'utf8')) as Record<string, unknown>,
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}
