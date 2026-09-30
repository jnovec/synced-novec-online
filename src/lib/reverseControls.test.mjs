import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';

const ts = createRequire(import.meta.url)('typescript');
const videoDisplayPath = fileURLToPath(new URL('../components/VideoGrid/VideoDisplay.tsx', import.meta.url));
const videoDisplay = ts.createSourceFile(videoDisplayPath, readFileSync(videoDisplayPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test('Reverse toggle performs seek and timer work outside a React state updater', () => {
  const updaterCalls = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'setVideoReversing') {
      const updater = node.arguments[0];
      if (updater && (ts.isArrowFunction(updater) || ts.isFunctionExpression(updater))) {
        updaterCalls.push(updater.getStart(videoDisplay));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(videoDisplay);

  assert.deepEqual(updaterCalls, [], 'React StrictMode can invoke state updaters more than once, which must not repeat seek/timer side effects');
});
