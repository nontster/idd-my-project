const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isSupportedNode } = require('./check-runtime.cjs');
const root = path.resolve(__dirname, '..');
const pin = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
const local = path.join(root, '.runtime', `node-v${pin}-${process.platform}-${process.arch}`, 'bin/node');
const node = isSupportedNode(process.versions.node) ? process.execPath : local;
if (!fs.existsSync(node)) {
  process.stderr.write('Node.js 24 >=24.15.0 <25 is required. Use the version in .nvmrc.\n');
  process.exit(1);
}
function run(args) {
  const result = spawnSync(node, args, { cwd: root, stdio: 'inherit', env: { ...process.env, PATH: path.dirname(node) + path.delimiter + process.env.PATH } });
  return result.status === null ? 1 : result.status;
}
function build() {
  fs.rmSync(path.join(root, 'build'), { recursive: true, force: true });
  return run([path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.test.json']);
}
const capabilityStatus = run([path.join(root, 'scripts/check-runtime.cjs')]);
if (capabilityStatus !== 0) process.exit(capabilityStatus);
const mode = process.argv[2];
let status;
if (mode === 'build') status = build();
else if (mode === 'test') {
  status = build();
  if (status === 0) {
    const suite = process.argv[3];
    const extra = process.argv.slice(4);
    const flags = suite === 'coverage' ? ['--coverage', '--runInBand', '--json', '--outputFile=coverage/test-results.json']
      : extra.includes('--runTestsByPath') ? [] : [`--testPathPatterns=build/tests/${suite}`];
    status = run([path.join(root, 'node_modules/jest/bin/jest.js'), ...flags, ...extra]);
    if (suite === 'coverage') {
      const gate = run([path.join(root, 'scripts/check-security-coverage.cjs')]);
      if (status === 0) status = gate;
    }
  }
} else if (mode === 'start' || mode === 'dev') {
  status = build();
  if (status === 0) {
    const entry = path.join(root, `build/src/bootstrap/${mode === 'dev' ? 'development' : 'main'}.js`);
    const invoke = `require(${JSON.stringify(entry)}).run(${mode === 'dev' ? 'process.env, process.argv.slice(1)' : ''})`;
    status = run(['-e', invoke, '--', ...process.argv.slice(3)]);
  }
} else status = 1;
process.exitCode = status;
