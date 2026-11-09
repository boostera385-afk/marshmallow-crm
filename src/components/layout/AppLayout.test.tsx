import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AppLayout from "./AppLayout";

const { state, stub } = vi.hoisted(() => {
  const state = { paused: false, mounted: [] as string[] };
  const stub = (name: string) => ({ default: () => { state.mounted.push(name); return <div data-testid={name} />; } });
  return { state, stub };
});

vi.mock("@/lib/notification-pause", () => ({ get NOTIFICATIONS_PAUSED() { return state.paused; } }));
vi.mock("@/components/notifications/NotificationBell", () => stub("NotificationBell"));
vi.mock("@/components/notifications/WorkflowAlerts", () => stub("WorkflowAlerts"));
vi.mock("@/components/notifications/UrgentLeadPopup", () => stub("UrgentLeadPopup"));
vi.mock("@/components/notifications/JobInProgressPopup", () => stub("JobInProgressPopup"));
vi.mock("@/components/notifications/QuoteUpdatedPopup", () => stub("QuoteUpdatedPopup"));
vi.mock("@/components/notifications/IncompleteDetailsPopup", () => stub("IncompleteDetailsPopup"));
vi.mock("@/components/notifications/HoldJobPopup", () => stub("HoldJobPopup"));
vi.mock("@/components/notifications/CrmUpdatePopup", () => stub("CrmUpdatePopup"));
vi.mock("@/components/notifications/OperatorWorkflowSync", () => stub("OperatorWorkflowSync"));
vi.mock("@/components/notifications/ExtensionUpdateStatus", () => stub("ExtensionUpdateStatus"));
vi.mock("@/components/leads/ScheduleRequirementPrompt", () => stub("ScheduleRequirementPrompt"));
vi.mock("@/components/layout/AppSidebar", () => stub("AppSidebar"));
vi.mock("@/components/layout/GlobalCommandMenu", () => ({ GlobalCommandMenu: () => null }));
vi.mock("@/components/notepad/FloatingNotepad", () => stub("FloatingNotepad"));
vi.mock("@/components/ThemeToggle", () => stub("ThemeToggle"));
vi.mock("@/contexts/NotepadContext", () => ({
  NotepadProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useNotepad: () => ({ toggleNotepad: vi.fn(), activeUserIds: [], isPickerOpen: false }),
}));

const NOTIFICATION_READERS = ["NotificationBell", "WorkflowAlerts", "UrgentLeadPopup", "JobInProgressPopup", "QuoteUpdatedPopup", "IncompleteDetailsPopup"];
const mount = (path = "/leads") => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route element={<AppLayout />}><Route path="*" element={<div>page</div>} /></Route></Routes></MemoryRouter>,
);

afterEach(cleanup);
beforeEach(() => { state.paused = false; state.mounted = []; });

it("mounts the notification bell, alerts and pop-ups when notifications are on", () => {
  mount();
  for (const name of NOTIFICATION_READERS) expect(screen.getByTestId(name)).toBeInTheDocument();
});

it("mounts no notification reader while notifications are paused", () => {
  state.paused = true; mount();
  for (const name of NOTIFICATION_READERS) expect(screen.queryByTestId(name)).not.toBeInTheDocument();
  expect(state.mounted.filter((name) => NOTIFICATION_READERS.includes(name))).toEqual([]);
});

it("keeps hold-job, CRM update and operator workflow alerts while notifications are paused", () => {
  state.paused = true; mount();
  for (const name of ["HoldJobPopup", "CrmUpdatePopup", "OperatorWorkflowSync", "ScheduleRequirementPrompt"]) {
    expect(screen.getByTestId(name)).toBeInTheDocument();
  }
});

it("still hides lead pop-ups on the Quo dashboard when notifications are on", () => {
  mount("/quo-dashboard");
  expect(screen.getByTestId("NotificationBell")).toBeInTheDocument();
  expect(screen.queryByTestId("UrgentLeadPopup")).not.toBeInTheDocument();
});
