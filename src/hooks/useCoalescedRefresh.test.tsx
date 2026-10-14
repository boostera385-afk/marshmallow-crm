import { StrictMode, useCallback } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCoalescedRefresh } from "./useCoalescedRefresh";

afterEach(cleanup);
describe("refresh lifecycle", () => {
  it("works after StrictMode effect replay and ignores retired scope callbacks", async () => {
    const commit = vi.fn();
    const { result, rerender } = renderHook(({ user }) => useCoalescedRefresh(useCallback(async (isCurrent) => {
      if (isCurrent()) commit(user);
    }, [user])), { initialProps: { user: "a" }, wrapper: StrictMode });
    const oldRefresh = result.current;
    await act(async () => { await oldRefresh(); });
    expect(commit).toHaveBeenLastCalledWith("a");
    rerender({ user: "b" });
    commit.mockClear();
    await act(async () => { await oldRefresh(); await result.current(); });
    expect(commit.mock.calls).toEqual([["b"]]);
  });
});
