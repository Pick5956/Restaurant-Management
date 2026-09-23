import assert from 'node:assert/strict';
import test from 'node:test';

import { resetRouteStack } from './navigation-runtime.ts';

test('root-level resets replace without dispatching an unhandled pop-to-top action', () => {
  const actions = [];

  resetRouteStack(
    {
      canDismiss: () => false,
      dismissAll: () => actions.push('dismiss-all'),
      replace: (href) => actions.push(`replace:${href}`),
    },
    '/login',
  );

  assert.deepEqual(actions, ['replace:/login']);
});

test('restaurant switching dismisses the prior stack before entering the new workspace', () => {
  const actions = [];

  resetRouteStack(
    {
      canDismiss: () => true,
      dismissAll: () => actions.push('dismiss-all'),
      replace: (href) => actions.push(`replace:${href}`),
    },
    '/more',
  );

  assert.deepEqual(actions, ['dismiss-all', 'replace:/more']);
});

test('auth and restaurant invalidation targets use the same non-backtrackable reset', () => {
  for (const target of ['/login', '/restaurants']) {
    const actions = [];

    resetRouteStack(
      {
        canDismiss: () => true,
        dismissAll: () => actions.push('dismiss-all'),
        replace: (href) => actions.push(`replace:${href}`),
      },
      target,
    );

    assert.deepEqual(actions, ['dismiss-all', `replace:${target}`]);
  }
});
