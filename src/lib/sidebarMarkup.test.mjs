import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');

const sidebarPath = fileURLToPath(new URL('../components/Sidebar.tsx', import.meta.url));
const sidebar = ts.createSourceFile(sidebarPath, readFileSync(sidebarPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const jsxName = (node) => {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText(sidebar);
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText(sidebar);
  return null;
};

const containsFlex = (node) => {
  if (jsxName(node) === 'Flex') return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (containsFlex(child)) found = true;
  });
  return found;
};

test('Sidebar does not nest a block Flex inside Chakra Text paragraph', () => {
  const textWithFlex = [];
  const visit = (node) => {
    if (ts.isJsxElement(node) && jsxName(node) === 'Text' && containsFlex(node)) {
      textWithFlex.push(node.getStart(sidebar));
    }
    ts.forEachChild(node, visit);
  };
  visit(sidebar);

  assert.deepEqual(textWithFlex, [], 'Text renders a <p>; nesting Flex (<div>) in it causes invalid SSR markup and hydration failure');
});
