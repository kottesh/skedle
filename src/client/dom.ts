// Typed DOM helpers that fail fast when markup and code diverge.

export function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`Missing required element #${id}`);
  }
  return el as T;
}

export function getInput(id: string): HTMLInputElement {
  const el = getElement(id);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`Element #${id} is not an <input>`);
  }
  return el;
}

export function getForm(id: string): HTMLFormElement {
  const el = getElement(id);
  if (!(el instanceof HTMLFormElement)) {
    throw new Error(`Element #${id} is not a <form>`);
  }
  return el;
}

/** Get the first focusable descendant of a container. */
export function firstFocusable(container: HTMLElement): HTMLElement | null {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type=hidden])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const nodes = container.querySelectorAll<HTMLElement>(selector);
  for (const node of nodes) {
    if (node.offsetParent !== null || node === document.activeElement) return node;
  }
  return nodes[0] ?? null;
}

export function focusableWithin(container: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type=hidden])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  return [...container.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}
