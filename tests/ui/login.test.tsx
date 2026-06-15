// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { LoginScreen } from "../../src/presentation/screens/LoginScreen";
import { CoreApiError } from "../../src/presentation/runtime/ipcClient";
import { renderScreen, makeSession } from "./harness";

describe("LoginScreen", () => {
  it("renders the sign-in form and the change-default-password notice", async () => {
    renderScreen(<LoginScreen />);
    expect(
      await screen.findByRole("heading", { name: /sign in/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/default admin password/i)).toBeInTheDocument();
  });

  it("submits the typed credentials to core.login", async () => {
    const login = vi.fn(async () => ({
      token: "t",
      session: makeSession(["students.read"]),
    }));
    const { user } = renderScreen(<LoginScreen />, { core: { login } });

    await user.type(await screen.findByLabelText(/username/i), "admin");
    await user.type(screen.getByLabelText(/password/i), "secret123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith({
        username: "admin",
        password: "secret123",
      }),
    );
  });

  it("shows the error message when login is rejected", async () => {
    const login = vi.fn(async () => {
      throw new CoreApiError({
        code: "UNAUTHENTICATED",
        message: "Invalid username or password.",
      });
    });
    const { user } = renderScreen(<LoginScreen />, { core: { login } });

    await user.click(await screen.findByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByText(/invalid username or password/i),
    ).toBeInTheDocument();
  });
});
