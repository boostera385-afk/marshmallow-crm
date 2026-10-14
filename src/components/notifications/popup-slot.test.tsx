import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NotificationPopupProvider, useNotificationPopupSlot, type PopupId } from "./popup-slot";

function Popup({
  id,
  wantsToShow,
}: {
  id: PopupId;
  wantsToShow: boolean;
}) {
  const isVisible = useNotificationPopupSlot(id, wantsToShow);
  if (!isVisible) return null;
  return <div data-testid={id}>{id}</div>;
}

describe("notification popup slot", () => {
  it("keeps a mandatory CRM announcement from overlapping operational popups", () => {
    render(<NotificationPopupProvider><Popup id="holdJob" wantsToShow /><Popup id="crmUpdate" wantsToShow /></NotificationPopupProvider>);
    expect(screen.getByTestId("crmUpdate")).toBeInTheDocument();
    expect(screen.queryByTestId("holdJob")).not.toBeInTheDocument();
  });
  it("gives a stop-work hold instruction priority over urgent work alerts", () => {
    render(<NotificationPopupProvider><Popup id="urgent" wantsToShow /><Popup id="holdJob" wantsToShow /></NotificationPopupProvider>);
    expect(screen.getByTestId("holdJob")).toBeInTheDocument();
    expect(screen.queryByTestId("urgent")).not.toBeInTheDocument();
  });
  it("shows only the highest priority popup when several are eligible", () => {
    render(
      <NotificationPopupProvider>
        <Popup id="urgent" wantsToShow />
        <Popup id="jobInProgress" wantsToShow />
        <Popup id="quoteUpdated" wantsToShow />
      </NotificationPopupProvider>,
    );

    expect(screen.getByTestId("urgent")).toBeInTheDocument();
    expect(screen.queryByTestId("jobInProgress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("quoteUpdated")).not.toBeInTheDocument();
  });

  it("hands the slot to the next popup once the higher one stops asking", () => {
    const { rerender } = render(
      <NotificationPopupProvider>
        <Popup id="urgent" wantsToShow />
        <Popup id="jobInProgress" wantsToShow />
      </NotificationPopupProvider>,
    );

    expect(screen.getByTestId("urgent")).toBeInTheDocument();

    rerender(
      <NotificationPopupProvider>
        <Popup id="urgent" wantsToShow={false} />
        <Popup id="jobInProgress" wantsToShow />
      </NotificationPopupProvider>,
    );

    expect(screen.queryByTestId("urgent")).not.toBeInTheDocument();
    expect(screen.getByTestId("jobInProgress")).toBeInTheDocument();
  });

  it("puts Incomplete details ahead of Quote Updated but behind Job in Progress", () => {
    const { rerender } = render(
      <NotificationPopupProvider>
        <Popup id="jobInProgress" wantsToShow />
        <Popup id="incompleteDetails" wantsToShow />
        <Popup id="quoteUpdated" wantsToShow />
      </NotificationPopupProvider>,
    );

    expect(screen.getByTestId("jobInProgress")).toBeInTheDocument();
    expect(screen.queryByTestId("incompleteDetails")).not.toBeInTheDocument();

    rerender(
      <NotificationPopupProvider>
        <Popup id="jobInProgress" wantsToShow={false} />
        <Popup id="incompleteDetails" wantsToShow />
        <Popup id="quoteUpdated" wantsToShow />
      </NotificationPopupProvider>,
    );

    expect(screen.getByTestId("incompleteDetails")).toBeInTheDocument();
    expect(screen.queryByTestId("quoteUpdated")).not.toBeInTheDocument();
  });

  it("shows nothing when no popup has anything to display", () => {
    render(
      <NotificationPopupProvider>
        <Popup id="urgent" wantsToShow={false} />
        <Popup id="quoteUpdated" wantsToShow={false} />
      </NotificationPopupProvider>,
    );

    expect(screen.queryByTestId("urgent")).not.toBeInTheDocument();
    expect(screen.queryByTestId("quoteUpdated")).not.toBeInTheDocument();
  });

  it("renders normally with no provider around it", () => {
    render(<Popup id="quoteUpdated" wantsToShow />);
    expect(screen.getByTestId("quoteUpdated")).toBeInTheDocument();
  });
});
