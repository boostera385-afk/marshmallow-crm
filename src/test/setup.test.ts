import { describe, expect, it } from "vitest";

describe("browser storage in the test environment", () => {
  it.each(["localStorage", "sessionStorage"] as const)("uses jsdom's %s for global and window access", (name) => {
    const storage = globalThis[name];
    const key = "storage-environment-regression";
    expect(storage).toBe(jsdom.window[name]);
    expect(storage).toBeInstanceOf(jsdom.window.Storage);
    try {
      storage.setItem(key, "saved");
      expect(window[name].getItem(key)).toBe("saved");
      window[name].removeItem(key);
      expect(storage.getItem(key)).toBeNull();
    } finally {
      storage.removeItem(key);
    }
  });

  it("keeps local and session storage independent", () => {
    const key = "storage-environment-regression";
    try {
      localStorage.setItem(key, "local");
      sessionStorage.setItem(key, "session");
      expect(localStorage.getItem(key)).toBe("local");
      expect(sessionStorage.getItem(key)).toBe("session");
    } finally {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  });
});
