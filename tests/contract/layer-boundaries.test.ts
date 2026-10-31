import { expect, test } from '@jest/globals';
import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
const root = resolve(__dirname, '../../../src');
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(resolve(directory, entry.name)) : entry.name.endsWith('.ts') ? [resolve(directory, entry.name)] : []);
}
test('domain, ports and services depend only on framework-free boundaries', () => {
  const violations: string[] = [];
  for (const file of files(root)) {
    const path = relative(root, file).replaceAll('\\', '/');
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const name = node.moduleSpecifier.text;
        const target = name.startsWith('.') ? relative(root, resolve(dirname(file), name)).replaceAll('\\', '/') : name;
        if (/^(domain|ports|services)\//.test(path) && (/^(adapters|routes|bootstrap)\//.test(target) || /^(node:)?(http|https|fs|sqlite)(\/|$)/.test(target))) violations.push(`${path}: ${name}`);
        if (path.startsWith('routes/') && /^(adapters|bootstrap)\//.test(target)) violations.push(`${path}: ${name}`);
      }
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  expect(violations).toEqual([]);
});
