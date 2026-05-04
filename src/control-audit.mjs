export async function collectInteractiveControls(page, { rootSelector = 'main' } = {}) {
  return page.locator(rootSelector).evaluate((root) => {
    const getControlName = (element) => {
      const ariaLabel = element.getAttribute('aria-label')?.trim();
      if (ariaLabel) {
        return ariaLabel;
      }

      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const label = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
          .filter(Boolean)
          .join(' ')
          .trim();
        if (label) {
          return label;
        }
      }

      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        const explicitLabel = element.id
          ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim()
          : '';
        if (explicitLabel) {
          return explicitLabel;
        }

        const wrappingLabel = element.closest('label')?.textContent?.trim();
        if (wrappingLabel) {
          return wrappingLabel;
        }

        const placeholder = element.getAttribute('placeholder')?.trim();
        if (placeholder) {
          return placeholder;
        }
      }

      return (
        element.getAttribute('title')?.trim() ||
        element.textContent?.replace(/\s+/g, ' ').trim() ||
        ''
      );
    };
    const selector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'summary',
      'textarea',
      '[role="button"]',
      '[role="checkbox"]',
      '[role="combobox"]',
      '[role="menuitem"]',
      '[role="searchbox"]',
      '[role="switch"]',
      '[role="tab"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const actionableSelector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'summary',
      'textarea',
      '[role="button"]',
      '[role="checkbox"]',
      '[role="combobox"]',
      '[role="menuitem"]',
      '[role="searchbox"]',
      '[role="switch"]',
      '[role="tab"]',
    ].join(',');
    const structuralGridRoles = new Set(['columnheader', 'gridcell', 'row', 'rowgroup']);
    const isVisibleAndOperable = (element) => {
      const rect = element.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom < 0 ||
        rect.right < 0 ||
        rect.top > window.innerHeight ||
        rect.left > window.innerWidth
      ) {
        return false;
      }

      let current = element;
      while (current instanceof HTMLElement) {
        const styles = window.getComputedStyle(current);
        if (
          styles.display === 'none' ||
          styles.visibility === 'hidden' ||
          styles.pointerEvents === 'none' ||
          Number.parseFloat(styles.opacity) <= 0.01
        ) {
          return false;
        }

        if (current === root) {
          break;
        }
        current = current.parentElement;
      }

      return true;
    };
    const controls = [];
    const seen = new Set();

    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      if (element.parentElement?.closest(selector)) {
        continue;
      }

      const role = element.getAttribute('role');
      if (structuralGridRoles.has(role) && !element.matches(actionableSelector)) {
        continue;
      }

      if (!isVisibleAndOperable(element)) {
        continue;
      }

      if (seen.has(element)) {
        continue;
      }
      seen.add(element);

      const qaIndex = controls.length;
      element.setAttribute('data-ui-qa-index', String(qaIndex));

      controls.push({
        disabled:
          element.hasAttribute('disabled') ||
          element.getAttribute('aria-disabled') === 'true' ||
          element.getAttribute('readonly') !== null,
        kind: role || element.tagName.toLowerCase() || 'control',
        name: getControlName(element),
        qaIndex,
        selector: `${element.tagName.toLowerCase()}[data-ui-qa-index="${qaIndex}"]`,
      });
    }

    return controls;
  });
}

export async function focusControl(page, qaIndex) {
  return page.evaluate((index) => {
    const element = document.querySelector(`[data-ui-qa-index="${index}"]`);
    if (!(element instanceof HTMLElement)) {
      return {
        detail: 'Control disappeared before focus check.',
        status: 'failed',
      };
    }

    element.focus();
    const focused =
      document.activeElement === element ||
      Boolean(element.contains(document.activeElement));

    return focused
      ? {
          detail: 'Control accepted focus.',
          status: 'passed',
        }
      : {
          detail: 'Control did not accept focus.',
          status: 'failed',
        };
  }, qaIndex);
}

export async function recordUiQaResult({
  artifactManager,
  check,
  control,
  detail,
  index,
  page,
  report,
  status,
  surface,
  theme,
}) {
  if (status !== 'failed') {
    report.record({
      check,
      control,
      detail,
      status,
      surface,
      theme,
    });
    return;
  }

  let screenshotPath = null;
  let resolvedDetail = detail;
  try {
    screenshotPath = await artifactManager.captureIssueScreenshot(page, {
      check,
      control,
      index,
      surface,
      theme,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown screenshot failure.';
    resolvedDetail = `${detail} Screenshot capture failed: ${message}`;
  }

  report.record({
    check,
    control,
    detail: resolvedDetail,
    ...(screenshotPath ? { screenshotPath } : {}),
    status,
    surface,
    theme,
  });
}
