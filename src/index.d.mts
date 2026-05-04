import type { Page } from 'playwright';

export type UiQaStatus = 'failed' | 'passed' | 'skipped';

export interface UiQaArtifactManager {
  readonly allowedArtifactRoot: string;
  readonly artifactDirectory: string;
  readonly issueScreenshotDirectory: string;
  readonly keepArtifacts: boolean;
  readonly markdownReportPath: string;
  readonly reportPath: string;
  captureIssueScreenshot(
    page: Page,
    options: {
      check: string;
      control: string;
      index: number;
      surface: string;
      theme: string;
    },
  ): Promise<string>;
  cleanupArtifacts(): void;
  cleanupIssueScreenshots(): void;
  ensureArtifactDirectory(): void;
}

export interface UiQaArtifactManagerOptions {
  readonly allowedArtifactRoot?: string;
  readonly issueScreenshotDirectory?: string;
  readonly keepArtifacts?: boolean;
  readonly markdownReportPath?: string;
  readonly reportPath?: string;
}

export interface UiQaControl {
  readonly disabled: boolean;
  readonly kind: string;
  readonly name: string;
  readonly qaIndex: number;
  readonly selector: string;
}

export interface UiQaReport {
  record(result: UiQaReportResult): void;
  startSurface(options: { surface: string; theme: string }): void;
  write(): void;
}

export interface UiQaReportOptions {
  readonly artifactManager?: UiQaArtifactManager;
  readonly countDescription?: string;
  readonly generatedBy?: string;
  readonly runId?: string | null;
  readonly title?: string;
}

export interface UiQaReportResult {
  readonly check: string;
  readonly control: string;
  readonly detail: string;
  readonly screenshotPath?: string;
  readonly snippetPath?: string;
  readonly status: UiQaStatus;
  readonly surface: string;
  readonly theme: string;
}

export declare const defaultUiQaArtifactDirectory: string;
export declare const defaultUiQaIssueScreenshotDirectory: string;
export declare const defaultUiQaMarkdownReportPath: string;
export declare const defaultUiQaReportPath: string;

export function assertVisibleInteractiveControlsAreReadable(
  page: Page,
  options?: {
    label?: string;
    minimumContrastRatio?: number;
    overlapTolerance?: number;
    rootSelector?: string;
  },
): Promise<void>;

export function collectInteractiveControls(
  page: Page,
  options?: { rootSelector?: string },
): Promise<UiQaControl[]>;

export function collectVisibleInteractiveControlReadabilityFindings(
  page: Page,
  options?: {
    minimumContrastRatio?: number;
    overlapTolerance?: number;
    rootSelector?: string;
  },
): Promise<string[]>;

export function createUiQaArtifactManager(
  options?: UiQaArtifactManagerOptions,
): UiQaArtifactManager;

export function createUiQaReport(options?: UiQaReportOptions): UiQaReport;

export function focusControl(
  page: Page,
  qaIndex: number,
): Promise<{ detail: string; status: UiQaStatus }>;

export function recordUiQaResult(options: {
  readonly artifactManager: UiQaArtifactManager;
  readonly check: string;
  readonly control: string;
  readonly detail: string;
  readonly index: number;
  readonly page: Page;
  readonly report: UiQaReport;
  readonly status: UiQaStatus;
  readonly surface: string;
  readonly theme: string;
}): Promise<void>;
