# SeaSharp Radar

Shared SeaSharp QA automation utilities.

## UI QA Runner

`@seasharpco/radar` provides a standalone browser QA runner that can be added to
any SeaSharp repo. It inventories visible controls, checks labels/readability,
focuses enabled controls, captures issue screenshots, and writes JSON plus
Markdown reports.

Install:

```bash
npm install --save-dev @seasharpco/radar playwright
```

Add `ui-qa.config.mjs` to the target repo:

```js
export default {
  artifactRoot: 'test-results/ui-qa',
  baseUrl: 'http://127.0.0.1:4173',
  healthUrl: 'http://127.0.0.1:4173',
  reportPath: 'test-results/ui-qa/report.json',
  rootSelector: 'body',
  startCommand: {
    command: 'npm',
    args: ['run', 'dev'],
  },
  strict: false,
  surfaces: [
    { name: 'Home', path: '/', waitForSelector: 'main' },
  ],
  viewport: '1440x900',
};
```

Run:

```bash
npx ui-qa --config ui-qa.config.mjs
```

The repo using Radar owns app-specific service startup, auth setup, seed data,
surface inventory, and workflow assertions. Radar owns the reusable control
audit, screenshots, reporting, optional process startup, and health polling.
