import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCliArgs } from './cli.mjs';

test('parseCliArgs maps repeated surfaces and local storage entries', async () => {
  const options = await parseCliArgs([
    '--base-url',
    'http://127.0.0.1:4173',
    '--surface',
    'Workspace=/',
    '--surface',
    'Plans=/nriver/plans',
    '--local-storage',
    'helixos_poc_persona=josh-demo',
    '--local-storage',
    'helixos_persona=josh-demo',
    '--strict',
  ]);

  assert.equal(options.baseUrl, 'http://127.0.0.1:4173');
  assert.equal(options.strict, true);
  assert.deepEqual(options.surfaces, [
    { name: 'Workspace', path: '/' },
    { name: 'Plans', path: '/nriver/plans' },
  ]);
  assert.deepEqual(options.localStorageEntries, [
    ['helixos_poc_persona', 'josh-demo'],
    ['helixos_persona', 'josh-demo'],
  ]);
});

test('parseCliArgs defaults to a single home surface', async () => {
  const options = await parseCliArgs([]);

  assert.deepEqual(options.surfaces, [{ name: 'Home', path: '/' }]);
  assert.deepEqual(options.viewport, { height: 900, width: 1440 });
  assert.equal(options.rootSelector, 'body');
});

test('parseCliArgs rejects malformed local storage entries', async () => {
  await assert.rejects(
    () => parseCliArgs(['--local-storage', 'missing-separator']),
    /key=value/,
  );
});

test('parseCliArgs accepts service startup and health options', async () => {
  const options = await parseCliArgs([
    '--start-command',
    'npm run dev',
    '--health-url',
    'http://127.0.0.1:3000',
    '--fail-on-console-error',
  ]);

  assert.deepEqual(options.startCommand, {
    args: ['run', 'dev'],
    command: 'npm',
  });
  assert.equal(options.healthUrl, 'http://127.0.0.1:3000');
  assert.equal(options.failOnConsoleError, true);
});
