/// <reference types="vitest/jsdom" />
import "@testing-library/jest-dom";

// Node's Web Storage globals can shadow jsdom's browser-owned storage in Vitest.
// Always use the current test window, never Node's unavailable/file-backed store.
for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => jsdom.window[name],
  });
}

if (typeof window !== "undefined") Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
