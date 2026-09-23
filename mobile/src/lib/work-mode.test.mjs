import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { WORKSPACE_HUB_ROUTE } from './workspace-route.ts';

test('every role lands on the hub after choosing a restaurant', () => {
  assert.equal(WORKSPACE_HUB_ROUTE, '/more');
});

// The constant is only half of it: the three places a session is sent after a
// restaurant is chosen all have to read it.
test('restaurant selection, the index redirect and invite acceptance all use the hub route', async () => {
  const workMode = await readFile(new URL('./work-mode.ts', import.meta.url), 'utf8');
  assert.match(workMode, /return WORKSPACE_HUB_ROUTE;/);
  for (const file of ['../providers/auth-provider.tsx', '../../app/index.tsx', '../../app/invite/[token].tsx']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /getDefaultWorkspaceRoute\(/, `${file} must route through getDefaultWorkspaceRoute`);
  }
});
