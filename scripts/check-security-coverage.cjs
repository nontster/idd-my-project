const fs = require('node:fs');
const path = require('node:path');
const { inventory } = require('./security-files.cjs');

function check(root) {
  const files = inventory(root);
  if (!files.security.length) return 'empty-inventory';
  for (const file of ['src/services/authentication.ts', 'src/services/revocation.ts']) {
    if (!files.security.includes(path.join(root, file))) return 'missing-required-source';
  }
  if (files.emitted.length !== files.actualEmitted.length || files.emitted.some(file => !files.actualEmitted.includes(file))) return 'emitted-inventory-mismatch';
  const report = JSON.parse(fs.readFileSync(path.join(root, 'coverage/coverage-final.json'), 'utf8'));
  const results = JSON.parse(fs.readFileSync(path.join(root, 'coverage/test-results.json'), 'utf8'));
  if (!results.success || results.numPendingTests || results.numTodoTests) return 'incomplete-test-run';
  for (const file of files.securityEmitted) {
    const key = Object.keys(report).find(key => fs.realpathSync(key) === fs.realpathSync(file));
    if (!key) return 'missing-security-coverage';
    if (Object.values(report[key].b).some(counts => counts.some(count => count <= 0))) return 'uncovered-security-branch';
  }
  return null;
}

let reason;
try { reason = check(path.resolve(process.argv[2] || process.cwd())); }
catch { reason = 'invalid-evidence'; }
process.stdout.write(JSON.stringify({ complete: reason === null, reason }) + '\n');
process.exitCode = reason === null ? 0 : 1;
