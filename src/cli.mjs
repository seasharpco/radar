#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  createUiQaArtifactManager,
  defaultUiQaReportPath,
} from './artifacts.mjs';
import {
  collectInteractiveControls,
  focusControl,
  recordUiQaResult,
} from './control-audit.mjs';
import { createUiQaReport } from './report.mjs';
import { collectVisibleInteractiveControlReadabilityFindings } from './visible-control-audit.mjs';

export async function main(argv = process.argv.slice(2)) {
  const options = await parseCliArgs(argv);

  if (options.help) {
    process.stdout.write(`${renderHelp()}\n`);
    return 0;
  }

  const result = await runUiQaCli(options);
  const summary = result.reportSummary;
  process.stdout.write(
    `UI QA complete: ${summary.total} checks, ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped.\n`,
  );
  process.stdout.write(`Report: ${result.reportPath}\n`);

  return options.strict && summary.failed > 0 ? 1 : 0;
}

export async function runUiQaCli({
  artifactRoot,
  baseUrl,
  failOnConsoleError,
  headed,
  healthTimeoutMs,
  healthUrl,
  keepArtifacts,
  localStorageEntries,
  minimumContrastRatio,
  overlapTolerance,
  reportPath,
  rootSelector,
  startCommand,
  strict,
  surfaces,
  theme,
  viewport,
}) {
  const resolvedReportPath = reportPath ?? defaultUiQaReportPath;
  const resolvedArtifactRoot = artifactRoot ?? dirname(resolvedReportPath);
  const artifactManager = createUiQaArtifactManager({
    allowedArtifactRoot: resolvedArtifactRoot,
    issueScreenshotDirectory: join(dirname(resolvedReportPath), 'issue-screenshots'),
    keepArtifacts,
    markdownReportPath: resolvedReportPath.replace(/\.json$/i, '.md'),
    reportPath: resolvedReportPath,
  });
  const report = createUiQaReport({
    artifactManager,
    countDescription:
      'Counts are generated UI QA control checks, not Playwright spec file counts.',
    generatedBy: 'radar-ui-qa',
    title: 'UI QA Report',
  });
  const managedProcess = startCommand
    ? startManagedProcess(startCommand)
    : null;
  const browser = await chromium.launch({ headless: !headed });
  const failed = [];
  let total = 0;

  try {
    if (healthUrl) {
      await waitForHealthUrl(healthUrl, healthTimeoutMs);
    }

    const page = await browser.newPage({ viewport });
    const consoleErrors = [];
    if (failOnConsoleError) {
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
      });
      page.on('pageerror', (error) => {
        consoleErrors.push(error.message);
      });
    }

    if (localStorageEntries.length > 0) {
      await page.addInitScript((entries) => {
        for (const [key, value] of entries) {
          window.localStorage.setItem(key, value);
        }
      }, localStorageEntries);
    }

    for (const surface of surfaces) {
      report.startSurface({ surface: surface.name, theme });
      await page.goto(resolveSurfaceUrl(baseUrl, surface.path), {
        waitUntil: 'domcontentloaded',
      });
      await waitForSurface(page, surface);
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});

      const findings = await collectVisibleInteractiveControlReadabilityFindings(page, {
        minimumContrastRatio,
        overlapTolerance,
        rootSelector,
      });
      for (const finding of findings) {
        total += 1;
        failed.push(`${surface.name}: ${finding}`);
        await recordUiQaResult({
          artifactManager,
          check: 'visual readability',
          control: surface.name,
          detail: finding,
          index: total,
          page,
          report,
          status: 'failed',
          surface: surface.name,
          theme,
        });
      }

      const controls = await collectInteractiveControls(page, { rootSelector });
      if (controls.length === 0) {
        total += 1;
        failed.push(`${surface.name}: no visible interactive controls found.`);
        await recordUiQaResult({
          artifactManager,
          check: 'control inventory',
          control: surface.name,
          detail: 'No visible interactive controls were found.',
          index: total,
          page,
          report,
          status: 'failed',
          surface: surface.name,
          theme,
        });
        continue;
      }

      for (const control of controls) {
        total += 1;
        const controlLabel = `${control.kind}: ${control.name || control.selector}`;
        const focusResult = await auditControlFocus(page, control);
        if (focusResult.status === 'failed') {
          failed.push(`${surface.name}: ${controlLabel}: ${focusResult.detail}`);
        }

        await recordUiQaResult({
          artifactManager,
          check: control.disabled ? 'disabled/read-only state' : 'happy focus path',
          control: controlLabel,
          detail: focusResult.detail,
          index: total,
          page,
          report,
          status: focusResult.status,
          surface: surface.name,
          theme,
        });
      }

      if (consoleErrors.length > 0) {
        for (const consoleError of consoleErrors.splice(0)) {
          total += 1;
          failed.push(`${surface.name}: console error: ${consoleError}`);
          await recordUiQaResult({
            artifactManager,
            check: 'browser console',
            control: surface.name,
            detail: consoleError,
            index: total,
            page,
            report,
            status: 'failed',
            surface: surface.name,
            theme,
          });
        }
      }
    }
  } finally {
    await browser.close();
    await stopManagedProcess(managedProcess);
    report.write();
  }

  const reportSummary = {
    failed: failed.length,
    passed: total - failed.length,
    skipped: 0,
    total,
  };

  return {
    failed,
    reportPath: resolvedReportPath,
    reportSummary,
    strict,
  };
}

export async function parseCliArgs(argv) {
  const raw = parseRawArgs(argv);
  const config = await loadConfig(raw.values.get('config'));
  const reportPath =
    raw.values.get('report-path') ?? process.env.UI_QA_REPORT_PATH ?? config.reportPath;
  const baseUrl = raw.values.get('base-url') ?? process.env.UI_QA_BASE_URL ?? config.baseUrl;

  return {
    artifactRoot: raw.values.get('artifact-root') ?? config.artifactRoot,
    baseUrl: baseUrl ?? 'http://127.0.0.1:5173',
    configPath: config.configPath,
    failOnConsoleError:
      raw.flags.has('fail-on-console-error') || config.failOnConsoleError === true,
    headed: raw.flags.has('headed'),
    healthTimeoutMs: Number.parseInt(
      raw.values.get('health-timeout-ms') ?? String(config.healthTimeoutMs ?? 60_000),
      10,
    ),
    healthUrl: raw.values.get('health-url') ?? config.healthUrl,
    help: raw.flags.has('help') || raw.flags.has('h'),
    keepArtifacts:
      raw.values.has('keep-artifacts')
        ? raw.values.get('keep-artifacts') !== 'false'
        : config.keepArtifacts !== false,
    localStorageEntries:
      raw.repeated.get('local-storage')?.map(parseKeyValue).filter(Boolean) ??
      normalizeLocalStorageEntries(config.localStorage),
    minimumContrastRatio: Number.parseFloat(
      raw.values.get('minimum-contrast-ratio') ?? String(config.minimumContrastRatio ?? 3),
    ),
    overlapTolerance: Number.parseFloat(
      raw.values.get('overlap-tolerance') ?? String(config.overlapTolerance ?? 0.15),
    ),
    reportPath,
    rootSelector: raw.values.get('root-selector') ?? config.rootSelector ?? 'body',
    startCommand: parseStartCommand(raw.values.get('start-command')) ?? config.startCommand,
    strict: raw.flags.has('strict') || config.strict === true,
    surfaces:
      raw.repeated.has('surface')
        ? parseSurfaces(raw.repeated.get('surface'))
        : normalizeSurfaces(config.surfaces ?? [{ name: 'Home', path: '/' }]),
    theme: raw.values.get('theme') ?? config.theme ?? 'default',
    viewport: parseViewport(raw.values.get('viewport') ?? config.viewport ?? '1440x900'),
  };
}

function auditControlFocus(page, control) {
  if (!control.name.trim()) {
    return {
      detail: 'Control is missing readable text, title, placeholder, or an accessible label.',
      status: 'failed',
    };
  }

  if (control.disabled) {
    return {
      detail: 'Control is disabled or read-only; disabled state is recorded.',
      status: 'passed',
    };
  }

  return focusControl(page, control.qaIndex);
}

function parseRawArgs(argv) {
  const flags = new Set();
  const repeated = new Map();
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current?.startsWith('--')) {
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      flags.add(key);
      continue;
    }

    values.set(key, next);
    repeated.set(key, [...(repeated.get(key) ?? []), next]);
    index += 1;
  }

  return { flags, repeated, values };
}

async function loadConfig(configPath) {
  const resolvedPath = configPath
    ? resolve(configPath)
    : findDefaultConfigPath();

  if (!resolvedPath) {
    return {};
  }

  if (resolvedPath.endsWith('.json')) {
    return {
      ...JSON.parse(readFileSync(resolvedPath, 'utf8')),
      configPath: resolvedPath,
    };
  }

  const module = await import(`${pathToFileURL(resolvedPath).href}?t=${Date.now()}`);
  const config = module.default ?? module.config ?? {};

  return {
    ...config,
    configPath: resolvedPath,
  };
}

function findDefaultConfigPath() {
  for (const candidate of [
    'ui-qa.config.mjs',
    'ui-qa.config.js',
    'ui-qa.config.json',
    '.ui-qa.config.mjs',
    '.ui-qa.config.json',
  ]) {
    const resolvedPath = resolve(candidate);
    if (existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  return null;
}

function parseKeyValue(value) {
  const separatorIndex = value.indexOf('=');
  if (separatorIndex <= 0) {
    throw new Error(`Expected --local-storage value to use key=value, received "${value}".`);
  }

  return [value.slice(0, separatorIndex), value.slice(separatorIndex + 1)];
}

function normalizeLocalStorageEntries(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      Array.isArray(entry) ? entry : parseKeyValue(String(entry)),
    );
  }

  return Object.entries(value).map(([key, entryValue]) => [key, String(entryValue)]);
}

function parseSurfaces(values) {
  return values.map((value) => {
    const separatorIndex = value.indexOf('=');
    if (separatorIndex <= 0) {
      return {
        name: value,
        path: value,
      };
    }

    return {
      name: value.slice(0, separatorIndex).trim(),
      path: value.slice(separatorIndex + 1).trim(),
    };
  });
}

function normalizeSurfaces(values) {
  return values.map((surface) => {
    if (typeof surface === 'string') {
      return parseSurfaces([surface])[0];
    }

    return pruneUndefined({
      name: surface.name ?? surface.label ?? surface.path,
      path: surface.path,
      waitForSelector: surface.waitForSelector,
      waitForText: surface.waitForText,
    });
  });
}

function parseStartCommand(value) {
  if (!value) {
    return null;
  }

  const [command, ...args] = splitCommand(value);
  return { args, command };
}

function parseViewport(value) {
  if (typeof value === 'object' && value) {
    return value;
  }

  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) {
    throw new Error(`Expected --viewport to use WIDTHxHEIGHT, received "${value}".`);
  }

  return {
    height: Number.parseInt(match[2], 10),
    width: Number.parseInt(match[1], 10),
  };
}

function renderHelp() {
  return [
    'Usage: ui-qa [options]',
    '',
    'Options:',
    '  --base-url <url>                 Base URL for relative surface paths.',
    '  --config <path>                  Config file. Defaults to ui-qa.config.*.',
    '  --surface <name=path>            Surface to audit. Repeat for multiple pages.',
    '  --start-command <command>        Optional service command to start before audit.',
    '  --health-url <url>               URL to poll before running the audit.',
    '  --health-timeout-ms <ms>         Health polling timeout. Default: 60000.',
    '  --local-storage <key=value>      Set localStorage before navigation. Repeatable.',
    '  --report-path <path>             JSON report path.',
    '  --artifact-root <path>           Allowed artifact root.',
    '  --root-selector <selector>       DOM root for control audits. Default: body.',
    '  --theme <name>                   Theme label recorded in the report.',
    '  --viewport <WIDTHxHEIGHT>        Browser viewport. Default: 1440x900.',
    '  --fail-on-console-error          Record browser console/page errors.',
    '  --strict                         Exit 1 when UI findings are recorded.',
    '  --headed                         Run Chromium headed.',
    '  --help                           Show this help.',
  ].join('\n');
}

function resolveSurfaceUrl(baseUrl, surfacePath) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(surfacePath)) {
    return surfacePath;
  }

  return new URL(surfacePath, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
}

async function waitForSurface(page, surface) {
  if (surface.waitForSelector) {
    await page.locator(surface.waitForSelector).first().waitFor({
      state: 'visible',
      timeout: surface.waitTimeoutMs ?? 30_000,
    });
  }

  if (surface.waitForText) {
    await page.getByText(surface.waitForText, { exact: false }).first().waitFor({
      state: 'visible',
      timeout: surface.waitTimeoutMs ?? 30_000,
    });
  }
}

function startManagedProcess(startCommand) {
  const command =
    typeof startCommand === 'string'
      ? parseStartCommand(startCommand)
      : startCommand;
  if (!command?.command) {
    throw new Error('startCommand must provide a command.');
  }

  const child = spawn(command.command, command.args ?? [], {
    cwd: command.cwd ? resolve(command.cwd) : process.cwd(),
    env: { ...process.env, ...(command.env ?? {}) },
    shell: command.shell === true,
    stdio: command.stdio ?? 'inherit',
    windowsHide: true,
  });

  child.on('error', (error) => {
    throw error;
  });

  return child;
}

async function stopManagedProcess(child) {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');

  await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
      resolvePromise();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

async function waitForHealthUrl(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  throw new Error(`Timed out waiting for health URL: ${url}`);
}

function splitCommand(value) {
  const parts = [];
  let current = '';
  let quote = null;

  for (const character of value.trim()) {
    if ((character === '"' || character === "'") && !quote) {
      quote = character;
      continue;
    }

    if (character === quote) {
      quote = null;
      continue;
    }

    if (/\s/.test(character) && !quote) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function pruneUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const exitCode = await main();
  process.exit(exitCode);
}
