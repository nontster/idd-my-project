function isSupportedNode(node) {
  const match = /^v?24\.(\d+)\.(\d+)$/.exec(node);
  return match !== null && Number(match[1]) >= 15;
}
function evaluateRuntime(node, sqlite) {
  const s = sqlite.split('.').map(Number);
  const nodeReady = isSupportedNode(node);
  const sqliteReady = s.length === 3 && s.every(Number.isInteger) && (s[0] > 3 || s[0] === 3 && (s[1] > 51 || s[1] === 51 && s[2] >= 3));
  return nodeReady && sqliteReady;
}
module.exports = { evaluateRuntime, isSupportedNode };
if (require.main === module) {
  let sqlite = 'unavailable';
  let ready = false;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    sqlite = db.prepare('select sqlite_version() as version').get().version;
    db.close();
    ready = evaluateRuntime(process.version, sqlite);
  } catch {}
  process.stdout.write(JSON.stringify({ ready, node: process.version, sqlite }) + '\n');
  process.exitCode = ready ? 0 : 1;
}
