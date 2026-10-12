import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import LeadPhotoActions from "./LeadPhotoActions";
import { toast } from "sonner";

const mocks = vi.hoisted(() => ({
  auth: { role: "admin", canAccess: (_key: string): boolean => true },
  copy: vi.fn(), sign: vi.fn(), resolveChat: vi.fn(), prepare: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/lead-copy", () => ({ copyImagesToClipboard: mocks.copy }));
vi.mock("@/lib/storage", () => ({ getSignedUrls: mocks.sign }));
vi.mock("@/lib/quo-tech-photos", () => ({ resolveTechPhotoChat: mocks.resolveChat, prepareTechPhotos: mocks.prepare }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.auth.role = "admin"; mocks.auth.canAccess = () => true; });

describe("lead photo action permissions", () => {
  it("views every saved photo in order without copying or sending", async () => {
    mocks.auth.role = "opr";
    mocks.auth.canAccess = () => false;
    mocks.sign.mockResolvedValue(["signed-one", "signed-two"]);
    const parentClick = vi.fn();
    render(<div onClick={parentClick}><LeadPhotoActions paths={["one", "two"]} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "View 2 photos" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Photo preview" })).toBeInTheDocument());
    expect(mocks.sign).toHaveBeenCalledWith(["one", "two"]);
    expect(screen.getByAltText("Image 1")).toHaveAttribute("src", "signed-one");
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByAltText("Image 2")).toHaveAttribute("src", "signed-two");
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(screen.getByAltText("Image 1")).toHaveAttribute("src", "signed-one");
    fireEvent.click(screen.getByRole("button", { name: "Close image" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("reports signing failure and lets the user retry", async () => {
    mocks.sign.mockRejectedValueOnce(new Error("Storage unavailable")).mockResolvedValueOnce(["signed-one"]);
    render(<LeadPhotoActions paths={["one"]} />);
    fireEvent.click(screen.getByRole("button", { name: "View 1 photo" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Storage unavailable"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View 1 photo" }));
    await waitFor(() => expect(screen.getByAltText("Image 1")).toHaveAttribute("src", "signed-one"));
    expect(screen.queryByRole("button", { name: "Next image" })).not.toBeInTheDocument();
  });

  it("shows image failures instead of silently dropping a photo", async () => {
    mocks.sign.mockResolvedValue(["signed-one"]);
    render(<LeadPhotoActions paths={["one"]} />);
    fireEvent.click(screen.getByRole("button", { name: "View 1 photo" }));
    const image = await screen.findByAltText("Image 1");
    fireEvent.error(image);
    expect(screen.getByText("Couldn't load this image. Try closing and reopening.")).toBeInTheDocument();
  });

  it("ignores an old signing response when the lead's photos change", async () => {
    let finish!: (urls: string[]) => void;
    mocks.sign.mockReturnValueOnce(new Promise<string[]>((resolve) => { finish = resolve; }));
    const { rerender } = render(<LeadPhotoActions paths={["old-photo"]} />);
    fireEvent.click(screen.getByRole("button", { name: "View 1 photo" }));
    expect(screen.getByRole("button", { name: "Loading photos..." })).toBeDisabled();
    rerender(<LeadPhotoActions paths={["new-photo"]} />);
    mocks.sign.mockResolvedValueOnce(["signed-new"]);
    fireEvent.click(screen.getByRole("button", { name: "View 1 photo" }));
    await waitFor(() => expect(screen.getByAltText("Image 1")).toHaveAttribute("src", "signed-new"));
    finish(["signed-old"]);
    await waitFor(() => expect(screen.getByAltText("Image 1")).toHaveAttribute("src", "signed-new"));
  });

  it("renders no photo actions for an empty saved-photo list", () => {
    render(<LeadPhotoActions paths={[]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("hides technician handoff for CS Admin even if Tech Quick Chat is granted", () => {
    mocks.auth.role = "cs_admin";
    render(<LeadPhotoActions paths={["one", "two"]} techNumber="4155550123" />);
    expect(screen.getByRole("button", { name: "Copy all 2 photos" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send photos to tech" })).not.toBeInTheDocument();
  });

  it("requires Tech Quick Chat permission for the technician action", () => {
    mocks.auth.canAccess = () => false;
    render(<LeadPhotoActions paths={["one"]} techNumber="4155550123" />);
    expect(screen.queryByRole("button", { name: "Send photos to tech" })).not.toBeInTheDocument();
  });

  it("hands all signed originals to the saved technician chat", async () => {
    mocks.resolveChat.mockResolvedValue("https://my.quo.com/inbox/tech/c/assigned");
    mocks.sign.mockResolvedValue(["signed-one", "signed-two"]);
    mocks.prepare.mockResolvedValue(undefined);
    render(<LeadPhotoActions paths={["one", "two"]} techNumber="4155550123" />);
    fireEvent.click(screen.getByRole("button", { name: "Send photos to tech" }));
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledWith("https://my.quo.com/inbox/tech/c/assigned", ["signed-one", "signed-two"]));
    expect(mocks.resolveChat).toHaveBeenCalledWith("4155550123");
  });
});
