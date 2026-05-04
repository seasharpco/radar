import assert from 'node:assert/strict';

export async function assertVisibleInteractiveControlsAreReadable(page, options = {}) {
  const findings = await collectVisibleInteractiveControlReadabilityFindings(page, options);

  assert.deepEqual(
    findings,
    [],
    `Visible interactive control audit failed${options.label ? ` for ${options.label}` : ''}:\n${findings.join('\n')}`,
  );
}

export async function collectVisibleInteractiveControlReadabilityFindings(
  page,
  options = {},
) {
  const {
    minimumContrastRatio = 3,
    overlapTolerance = 0.15,
    rootSelector = 'body',
  } = options;

  return page.evaluate(
    ({ minimumContrastRatio, overlapTolerance, rootSelector }) => {
      const root = document.querySelector(rootSelector);
      if (!root) {
        return [`Audit root "${rootSelector}" was not found.`];
      }

      const interactiveSelector = [
        'a[href]',
        'button',
        'input:not([type="hidden"])',
        'select',
        'summary',
        'textarea',
        '[role="button"]',
        '[role="checkbox"]',
        '[role="combobox"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="searchbox"]',
        '[role="spinbutton"]',
        '[role="switch"]',
        '[role="tab"]',
        '[role="textbox"]',
      ].join(',');
      const parseCssNumber = (value) => {
        const trimmedValue = value.trim();

        return trimmedValue.endsWith('%')
          ? Number.parseFloat(trimmedValue) / 100
          : Number.parseFloat(trimmedValue);
      };
      const parseColor = (value) => {
        const hexMatch = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
        if (hexMatch) {
          const compactHex = hexMatch[1];
          const normalizedHex =
            compactHex.length === 3
              ? compactHex
                  .split('')
                  .map((channel) => `${channel}${channel}`)
                  .join('')
              : compactHex;

          return {
            alpha: 1,
            blue: Number.parseInt(normalizedHex.slice(4, 6), 16),
            green: Number.parseInt(normalizedHex.slice(2, 4), 16),
            red: Number.parseInt(normalizedHex.slice(0, 2), 16),
          };
        }

        const rgbMatch = value.match(/rgba?\(([^)]+)\)/i);
        if (rgbMatch) {
          const [red, green, blue, alpha = 1] = rgbMatch[1]
            .split(',')
            .slice(0, 4)
            .map((part) => parseCssNumber(part));

          return { alpha, blue, green, red };
        }

        const oklchMatch = value.match(/oklch\(([^)]+)\)/i);
        const oklabMatch = value.match(/oklab\(([^)]+)\)/i);
        if (!oklchMatch && !oklabMatch) {
          return null;
        }

        const [lightness, firstAxis, secondAxis, alpha = 1] = (
          oklchMatch ?? oklabMatch
        )[1]
          .replace(/\s*\/\s*/g, ' ')
          .split(/\s+/)
          .slice(0, 4)
          .map((part) => parseCssNumber(part));
        const hueRadians = ((oklchMatch ? secondAxis : 0) * Math.PI) / 180;
        const a = oklchMatch ? firstAxis * Math.cos(hueRadians) : firstAxis;
        const b = oklchMatch ? firstAxis * Math.sin(hueRadians) : secondAxis;
        const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
        const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
        const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
        const l = lPrime ** 3;
        const m = mPrime ** 3;
        const s = sPrime ** 3;
        const toSrgb = (channel) => {
          const srgb =
            channel <= 0.0031308
              ? 12.92 * channel
              : 1.055 * channel ** (1 / 2.4) - 0.055;

          return Math.min(255, Math.max(0, srgb * 255));
        };

        return {
          alpha,
          blue: toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
          green: toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
          red: toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        };
      };
      const firstBackgroundImageColor = (backgroundImage) => {
        const colorMatch = backgroundImage.match(
          /#[\da-f]{3,6}\b|rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)/i,
        );

        return colorMatch ? parseColor(colorMatch[0]) : null;
      };
      const composite = (front, back) => {
        const alpha = front.alpha + back.alpha * (1 - front.alpha);
        if (alpha === 0) {
          return { alpha: 0, blue: 255, green: 255, red: 255 };
        }

        return {
          alpha,
          blue:
            (front.blue * front.alpha + back.blue * back.alpha * (1 - front.alpha)) /
            alpha,
          green:
            (front.green * front.alpha +
              back.green * back.alpha * (1 - front.alpha)) /
            alpha,
          red:
            (front.red * front.alpha + back.red * back.alpha * (1 - front.alpha)) /
            alpha,
        };
      };
      const pageBackground = (element) => {
        const layers = [];
        let current = element;
        while (current instanceof Element) {
          const styles = window.getComputedStyle(current);
          const backgroundColor = parseColor(styles.backgroundColor);
          const color =
            backgroundColor && backgroundColor.alpha > 0
              ? backgroundColor
              : firstBackgroundImageColor(styles.backgroundImage);
          if (color && color.alpha > 0) {
            layers.unshift(color);
          }
          current = current.parentElement;
        }

        return layers.reduce(
          (background, layer) => composite(layer, background),
          { alpha: 1, blue: 255, green: 255, red: 255 },
        );
      };
      const foregroundColor = (element, background) => {
        const color = parseColor(window.getComputedStyle(element).color);

        return color ? composite(color, background) : background;
      };
      const toLinear = (channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      const luminance = ({ red, green, blue }) =>
        0.2126 * toLinear(red) + 0.7152 * toLinear(green) + 0.0722 * toLinear(blue);
      const contrastRatio = (foreground, background) => {
        const lighter = Math.max(luminance(foreground), luminance(background));
        const darker = Math.min(luminance(foreground), luminance(background));

        return (lighter + 0.05) / (darker + 0.05);
      };
      const isVisible = (element) => {
        const rect = element.getBoundingClientRect();
        if (
          rect.width < 4 ||
          rect.height < 4 ||
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
      const controlName = (element) => {
        const labelledBy = element.getAttribute('aria-labelledby');
        const labelText = labelledBy
          ?.split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim())
          .filter(Boolean)
          .join(' ');
        const labelElement =
          element.id && element instanceof HTMLElement
            ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
            : null;
        const text =
          element.getAttribute('aria-label') ||
          labelText ||
          labelElement?.textContent ||
          element.getAttribute('title') ||
          (element instanceof HTMLInputElement ? element.placeholder || element.value : '') ||
          element.textContent ||
          element.getAttribute('href') ||
          element.tagName.toLowerCase();

        return text.replace(/\s+/g, ' ').trim();
      };
      const textPaintElements = (element) => {
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
        ) {
          return [element];
        }

        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const paintElements = new Set();
        let node = walker.nextNode();
        while (node) {
          if (node.textContent?.replace(/\s+/g, ' ').trim()) {
            const parent = node.parentElement;
            if (parent && isVisible(parent)) {
              paintElements.add(parent);
            }
          }
          node = walker.nextNode();
        }

        return Array.from(paintElements);
      };
      const rectToObject = (element) => {
        const rect = element.getBoundingClientRect();

        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        };
      };
      const canScrollOverflow = (element) => {
        const styles = window.getComputedStyle(element);

        return (
          element instanceof HTMLTextAreaElement ||
          element.getAttribute('role') === 'textbox' ||
          ['auto', 'scroll'].includes(styles.overflow) ||
          ['auto', 'scroll'].includes(styles.overflowX) ||
          ['auto', 'scroll'].includes(styles.overflowY)
        );
      };
      const controls = Array.from(root.querySelectorAll(interactiveSelector))
        .filter((element) => !element.closest('[aria-hidden="true"]'))
        .filter((element) => !element.parentElement?.closest(interactiveSelector))
        .filter(isVisible)
        .map((element) => ({
          element,
          name: controlName(element),
          rect: rectToObject(element),
          tag: element.tagName.toLowerCase(),
        }));
      const messages = [];

      for (const control of controls) {
        if (!control.name) {
          messages.push(`Visible ${control.tag} control is missing readable text or a label.`);
        }

        const paintElements = textPaintElements(control.element);
        for (const textElement of paintElements) {
          const background = pageBackground(textElement);
          const contrast = contrastRatio(
            foregroundColor(textElement, background),
            background,
          );
          if (contrast < minimumContrastRatio) {
            messages.push(
              `"${control.name}" text contrast is ${contrast.toFixed(2)}:1; expected at least ${minimumContrastRatio}:1.`,
            );
          }
        }

        if (
          paintElements.length > 0 &&
          !canScrollOverflow(control.element) &&
          (control.element.scrollWidth > control.element.clientWidth + 2 ||
            control.element.scrollHeight > control.element.clientHeight + 2)
        ) {
          messages.push(`"${control.name}" text appears clipped or overflowing its control.`);
        }
      }

      for (let index = 0; index < controls.length; index += 1) {
        const first = controls[index];
        for (let otherIndex = index + 1; otherIndex < controls.length; otherIndex += 1) {
          const second = controls[otherIndex];
          const left = Math.max(first.rect.left, second.rect.left);
          const right = Math.min(first.rect.right, second.rect.right);
          const top = Math.max(first.rect.top, second.rect.top);
          const bottom = Math.min(first.rect.bottom, second.rect.bottom);
          const overlapWidth = right - left;
          const overlapHeight = bottom - top;
          if (overlapWidth <= 2 || overlapHeight <= 2) {
            continue;
          }

          const overlapArea = overlapWidth * overlapHeight;
          const smallerArea = Math.min(
            first.rect.width * first.rect.height,
            second.rect.width * second.rect.height,
          );
          if (overlapArea / smallerArea > overlapTolerance) {
            messages.push(
              `"${first.name}" overlaps "${second.name}" by ${Math.round(overlapArea)}px.`,
            );
          }
        }
      }

      return messages;
    },
    { minimumContrastRatio, overlapTolerance, rootSelector },
  );
}
