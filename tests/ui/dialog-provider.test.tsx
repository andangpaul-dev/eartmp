// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DialogProvider,
  useDialogs,
} from "../../src/presentation/runtime/DialogProvider";

function ConfirmHarness({ onResult }: { onResult: (v: boolean) => void }) {
  const { confirm } = useDialogs();
  return (
    <button
      type="button"
      onClick={async () =>
        onResult(
          await confirm({
            title: "Delete X?",
            danger: true,
            confirmLabel: "Delete",
          }),
        )
      }
    >
      go
    </button>
  );
}

function PromptHarness({ onResult }: { onResult: (v: string | null) => void }) {
  const { prompt } = useDialogs();
  return (
    <button
      type="button"
      onClick={async () =>
        onResult(
          await prompt({
            title: "Rename",
            fieldLabel: "Name",
            defaultValue: "old",
          }),
        )
      }
    >
      go
    </button>
  );
}

describe("DialogProvider", () => {
  it("confirm() resolves true on confirm and false on cancel", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <DialogProvider>
        <ConfirmHarness onResult={onResult} />
      </DialogProvider>,
    );

    await user.click(screen.getByText("go"));
    expect(await screen.findByText("Delete X?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));

    await user.click(screen.getByText("go"));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
  });

  it("prompt() returns the edited value (defaulted from the current value)", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    render(
      <DialogProvider>
        <PromptHarness onResult={onResult} />
      </DialogProvider>,
    );

    await user.click(screen.getByText("go"));
    const input = await screen.findByLabelText("Name");
    expect(input).toHaveValue("old");
    await user.clear(input);
    await user.type(input, "new");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("new"));
  });
});
