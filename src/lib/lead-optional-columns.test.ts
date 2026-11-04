import { beforeEach, expect, it, vi } from "vitest";
import { isMissingColumnError, resetOptionalLeadColumns, selectWithAiTagColumn } from "@/lib/lead-optional-columns";

beforeEach(() => resetOptionalLeadColumns());

it("asks for the AI tag marker with the list columns", async () => {
  const run = vi.fn().mockResolvedValue({ data: [{ id: "1", cs_tag_source: "ai" }], error: null });
  const result = await selectWithAiTagColumn("id, cs_tag", run);
  expect(run).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledWith("id, cs_tag, cs_tag_source");
  expect(result.data).toEqual([{ id: "1", cs_tag_source: "ai" }]);
});

it("keeps the list working before the migration, and stops asking for the column", async () => {
  const missing = { code: "42703", message: "column leads.cs_tag_source does not exist" };
  const run = vi.fn((columns: string) => Promise.resolve(columns.includes("cs_tag_source") ? { data: null, error: missing } : { data: [{ id: "1" }], error: null }));
  expect((await selectWithAiTagColumn("id", run)).data).toEqual([{ id: "1" }]);
  expect(run.mock.calls.map(([columns]) => columns)).toEqual(["id, cs_tag_source", "id"]);
  await selectWithAiTagColumn("id", run);
  expect(run).toHaveBeenLastCalledWith("id");
  expect(run).toHaveBeenCalledTimes(3);
});

it("does not hide other errors", async () => {
  const denied = { code: "42501", message: "permission denied for table leads" };
  const run = vi.fn().mockResolvedValue({ data: null, error: denied });
  expect((await selectWithAiTagColumn("id", run)).error).toBe(denied);
  expect(run).toHaveBeenCalledOnce();
  expect(isMissingColumnError({ code: "42703", message: "column leads.other does not exist" }, "cs_tag_source")).toBe(false);
});
