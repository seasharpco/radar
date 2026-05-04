import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export const defaultUiQaReportPath =
  process.env.UI_QA_REPORT_PATH ?? 'e2e/artifacts/ui-qa/report.json';

export const defaultUiQaArtifactDirectory = dirname(defaultUiQaReportPath);

export const defaultUiQaMarkdownReportPath =
  defaultUiQaReportPath.replace(/\.json$/i, '.md');

export const defaultUiQaIssueScreenshotDirectory = join(
  defaultUiQaArtifactDirectory,
  'issue-screenshots',
);

export function createUiQaArtifactManager({
  allowedArtifactRoot = defaultUiQaArtifactDirectory,
  issueScreenshotDirectory = defaultUiQaIssueScreenshotDirectory,
  keepArtifacts = process.env.UI_QA_KEEP_ARTIFACTS === '1',
  markdownReportPath = defaultUiQaMarkdownReportPath,
  reportPath = defaultUiQaReportPath,
} = {}) {
  const artifactDirectory = dirname(reportPath);

  function ensureArtifactDirectory() {
    assertSafeChildPath(artifactDirectory, allowedArtifactRoot, 'artifact directory');
    mkdirSync(artifactDirectory, { recursive: true });
  }

  function cleanupArtifacts() {
    if (keepArtifacts) {
      return;
    }

    assertSafeChildPath(artifactDirectory, allowedArtifactRoot, 'artifact directory');
    rmSync(resolve(artifactDirectory), { force: true, recursive: true });
  }

  function cleanupIssueScreenshots() {
    assertSafeChildPath(issueScreenshotDirectory, allowedArtifactRoot, 'issue screenshot directory');
    rmSync(resolve(issueScreenshotDirectory), { force: true, recursive: true });
  }

  async function captureIssueScreenshot(
    page,
    {
      check,
      control,
      index,
      surface,
      theme,
    },
  ) {
    ensureArtifactDirectory();
    mkdirSync(issueScreenshotDirectory, { recursive: true });

    const screenshotPath = buildIssueScreenshotPath({
      check,
      control,
      index,
      issueScreenshotDirectory,
      surface,
      theme,
    });
    await page.screenshot({ fullPage: true, path: screenshotPath });

    return screenshotPath;
  }

  return {
    allowedArtifactRoot,
    artifactDirectory,
    captureIssueScreenshot,
    cleanupArtifacts,
    cleanupIssueScreenshots,
    ensureArtifactDirectory,
    issueScreenshotDirectory,
    keepArtifacts,
    markdownReportPath,
    reportPath,
  };
}

function buildIssueScreenshotPath({
  check,
  control,
  index,
  issueScreenshotDirectory,
  surface,
  theme,
}) {
  const filename = [
    String(index).padStart(4, '0'),
    theme,
    surface,
    control,
    check,
  ]
    .map(slugifyPathPart)
    .filter(Boolean)
    .join('__')
    .slice(0, 180);

  const screenshotPath = resolve(
    issueScreenshotDirectory,
    `${filename || 'ui-qa-issue'}.png`,
  );
  assertSafeChildPath(screenshotPath, issueScreenshotDirectory, 'issue screenshot');

  return screenshotPath;
}

function assertSafeChildPath(candidate, parent, label) {
  const repoRoot = resolve('.');
  const resolvedCandidate = resolve(candidate);
  const resolvedParent = resolve(parent);

  if (
    !isSameOrChildPath(resolvedCandidate, resolvedParent) ||
    !isSameOrChildPath(resolvedParent, repoRoot)
  ) {
    throw new Error(`Refusing to touch unexpected UI QA ${label} path: ${resolvedCandidate}`);
  }
}

function isSameOrChildPath(candidate, parent) {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

function slugifyPathPart(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
