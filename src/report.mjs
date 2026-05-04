import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createUiQaArtifactManager } from './artifacts.mjs';

export function createUiQaReport({
  artifactManager = createUiQaArtifactManager(),
  countDescription = 'Counts are generated UI QA control and workflow test cases, not test-runner file counts.',
  generatedBy = 'ui-qa',
  runId = process.env.UI_QA_RUN_ID ?? null,
  title = 'UI QA Report',
} = {}) {
  artifactManager.cleanupArtifacts();
  artifactManager.cleanupIssueScreenshots();
  artifactManager.ensureArtifactDirectory();

  const startedAt = new Date().toISOString();
  const results = [];
  let currentSurface = null;
  let currentTheme = null;

  return {
    record(result) {
      results.push({
        checkedAt: new Date().toISOString(),
        ...result,
      });
      writeJsonReport({
        artifactManager,
        countDescription,
        currentSurface,
        currentTheme,
        finishedAt: null,
        generatedBy,
        results,
        runId,
        startedAt,
        title,
      });
    },
    startSurface({ surface, theme }) {
      currentSurface = surface;
      currentTheme = theme;
      writeJsonReport({
        artifactManager,
        countDescription,
        currentSurface,
        currentTheme,
        finishedAt: null,
        generatedBy,
        results,
        runId,
        startedAt,
        title,
      });
    },
    write() {
      const finishedAt = new Date().toISOString();
      const payload = buildPayload({
        currentSurface,
        currentTheme,
        countDescription,
        finishedAt,
        generatedBy,
        results,
        runId,
        startedAt,
        title,
      });

      artifactManager.ensureArtifactDirectory();
      writeFileSync(artifactManager.reportPath, `${JSON.stringify(payload, null, 2)}\n`);
      writeFileSync(artifactManager.markdownReportPath, renderMarkdown(payload));
      artifactManager.cleanupArtifacts();
    },
  };
}

function writeJsonReport({
  artifactManager,
  countDescription,
  currentSurface,
  currentTheme,
  finishedAt,
  generatedBy,
  results,
  runId,
  startedAt,
  title,
}) {
  const payload = buildPayload({
    countDescription,
    currentSurface,
    currentTheme,
    finishedAt,
    generatedBy,
    results,
    runId,
    startedAt,
    title,
  });

  mkdirSync(dirname(artifactManager.reportPath), { recursive: true });
  writeFileSync(artifactManager.reportPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function buildPayload({
  countDescription,
  currentSurface,
  currentTheme,
  finishedAt,
  generatedBy,
  results,
  runId,
  startedAt,
  title,
}) {
  return {
    countDescription,
    currentSurface,
    currentTheme,
    finishedAt,
    generatedBy,
    results,
    runId,
    startedAt,
    summary: summarize(results),
    surfaceSummaries: summarizeBySurface(results),
    testCaseSummary: summarize(results),
    title,
  };
}

function summarize(results) {
  return results.reduce(
    (summary, result) => {
      if (result.status === 'skipped') {
        return {
          ...summary,
          skipped: summary.skipped + 1,
          total: summary.total + 1,
        };
      }

      if (result.status === 'passed') {
        return {
          ...summary,
          passed: summary.passed + 1,
          total: summary.total + 1,
        };
      }

      return {
        ...summary,
        failed: summary.failed + 1,
        total: summary.total + 1,
      };
    },
    {
      failed: 0,
      passed: 0,
      skipped: 0,
      total: 0,
    },
  );
}

function summarizeBySurface(results) {
  const summaries = new Map();

  for (const result of results) {
    const key = `${result.theme}::${result.surface}`;
    const existing =
      summaries.get(key) ??
      {
        controls: [],
        failed: 0,
        latestControl: null,
        latestStatus: null,
        passed: 0,
        skipped: 0,
        surface: result.surface,
        theme: result.theme,
        total: 0,
        updatedAt: null,
      };

    const next = {
      ...existing,
      controls: [...existing.controls, result],
      latestControl: result.control,
      latestStatus: result.status,
      total: existing.total + 1,
      updatedAt: result.checkedAt,
      ...(result.status === 'passed'
        ? { passed: existing.passed + 1 }
        : result.status === 'skipped'
          ? { skipped: existing.skipped + 1 }
          : { failed: existing.failed + 1 }),
    };

    summaries.set(key, next);
  }

  return Array.from(summaries.values());
}

function renderMarkdown(report) {
  const lines = [
    `# ${report.title}`,
    '',
    `Started: ${report.startedAt}`,
    `Finished: ${report.finishedAt}`,
    '',
    '## Summary',
    '',
    `- Test cases: ${report.testCaseSummary.total}`,
    `- Passed: ${report.testCaseSummary.passed}`,
    `- Failed: ${report.testCaseSummary.failed}`,
    `- Skipped: ${report.testCaseSummary.skipped}`,
    '',
    report.countDescription,
    '',
    '## Controls by Page',
    '',
    '| Theme | Surface | Total | Passed | Failed | Skipped | Latest Control |',
    '|---|---|---:|---:|---:|---:|---|',
  ];

  for (const surface of report.surfaceSummaries) {
    lines.push(
      `| ${escapeCell(surface.theme)} | ${escapeCell(surface.surface)} | ${surface.total} | ${surface.passed} | ${surface.failed} | ${surface.skipped} | ${escapeCell(truncateCell(surface.latestControl))} |`,
    );
  }

  lines.push(
    '',
    '## Controls',
    '',
    '| Status | Theme | Surface | Control | Check | Detail |',
    '|---|---|---|---|---|---|',
  );

  for (const result of report.results) {
    lines.push(
      `| ${escapeCell(result.status)} | ${escapeCell(result.theme)} | ${escapeCell(result.surface)} | ${escapeCell(result.control)} | ${escapeCell(result.check)} | ${escapeCell(result.detail)} |`,
    );
  }

  const failedResultsWithScreenshots = report.results.filter(
    (result) => result.status === 'failed' && result.screenshotPath,
  );
  if (failedResultsWithScreenshots.length > 0) {
    lines.push('', '## Issue Screenshots', '');

    for (const result of failedResultsWithScreenshots) {
      const title = `${result.theme} / ${result.surface} / ${result.control}`;
      lines.push(
        `### ${title}`,
        '',
        `- Check: ${result.check}`,
        `- Detail: ${result.detail}`,
        ...(result.snippetPath
          ? [
              '- Snippet:',
              '',
              `<img alt="${escapeHtmlAttribute(title)} snippet" src="${toScreenshotLink(result.snippetPath)}" width="360">`,
              '',
            ]
          : []),
        `- Full page screenshot: [Open screenshot](${toScreenshotLink(result.screenshotPath)})`,
        '',
      );
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function escapeCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function truncateCell(value) {
  const text = String(value ?? '');
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function toScreenshotLink(value) {
  const text = String(value ?? '').trim();
  if (/^[a-z]:[\\/]/i.test(text) || text.startsWith('\\\\')) {
    return pathToFileURL(text).href;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    return text;
  }

  return pathToFileURL(text).href;
}

function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
