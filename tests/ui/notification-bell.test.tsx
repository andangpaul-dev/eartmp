// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import { NotificationBell } from "../../src/presentation/components/NotificationBell";
import { renderScreen } from "./harness";

const items = [
  {
    id: "n1",
    recipientRole: "REGISTRAR",
    actorUserId: "dee",
    title: "dee entered results — ready to process & lock.",
    body: null,
    level: "INFO",
    isRead: false,
    createdAt: new Date().toISOString(),
  },
];

describe("NotificationBell", () => {
  it("shows the unread count, lists handoffs, and marks one read", async () => {
    const markNotificationRead = vi.fn(async () => ({ ok: true as const }));
    const { user } = renderScreen(<NotificationBell />, {
      permissions: [],
      core: {
        listNotifications: async () => ({ items, unread: 1 }),
        markNotificationRead,
      },
    });

    // Unread badge.
    expect(await screen.findByText("1")).toBeInTheDocument();

    // Open the dropdown → the handoff is listed (scope to the menu; the same
    // text also flashes as an arrival toast).
    await user.click(screen.getByRole("button", { name: /notifications/i }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText(/ready to process/i)).toBeInTheDocument();

    // Mark the single item read (not "Mark all read").
    await user.click(within(menu).getByRole("button", { name: "Mark read" }));
    await waitFor(() =>
      expect(markNotificationRead).toHaveBeenCalledWith({ id: "n1" }),
    );
  });

  it("shows a caught-up state with no notifications", async () => {
    const { user } = renderScreen(<NotificationBell />, {
      permissions: [],
      core: { listNotifications: async () => ({ items: [], unread: 0 }) },
    });
    await user.click(
      await screen.findByRole("button", { name: /notifications/i }),
    );
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });
});
