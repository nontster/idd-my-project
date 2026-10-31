const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function walk(directory, suffix) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const item = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(item, suffix) : item.endsWith(suffix) ? [item] : [];
  }).sort();
}

function inventory(root) {
  const sources = walk(path.join(root, 'src'), '.ts').filter(file => !file.endsWith('.d.ts'));
  const security = sources.filter(file => {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    return source.statements.some(statement => {
      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return false;
      if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) return false;
      if (ts.isExportDeclaration(statement) && statement.isTypeOnly) return false;
      return true;
    });
  });
  const emittedFor = file => path.join(root, 'build', path.relative(root, file)).replace(/\.ts$/, '.js');
  return { sources, security, emitted: sources.map(emittedFor), securityEmitted: security.map(emittedFor),
    actualEmitted: walk(path.join(root, 'build/src'), '.js') };
}

module.exports = { inventory };
