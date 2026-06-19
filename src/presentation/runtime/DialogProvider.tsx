/**
 * DialogProvider — promise-based confirm()/prompt() so screens replace the jarring
 * native window.confirm/prompt with the app's branded, focus-trapped, scrollable
 * Modal. Usage:
 *
 *   const { confirm, prompt } = useDialogs();
 *   if (await confirm({ title: "Delete X?", danger: true })) … ;
 *   const name = await prompt({ title: "Rename", defaultValue: cur });
 */
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Modal, Button, Field } from "../components/ui";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
export interface PromptOptions {
  title: string;
  message?: string;
  fieldLabel?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

interface Dialogs {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const Ctx = createContext<Dialogs>({
  confirm: async () => false,
  prompt: async () => null,
});

type Pending =
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | {
      kind: "prompt";
      opts: PromptOptions;
      resolve: (v: string | null) => void;
    };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setPending({ kind: "confirm", opts, resolve }),
      ),
    [],
  );
  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(opts.defaultValue ?? "");
        setPending({ kind: "prompt", opts, resolve });
      }),
    [],
  );

  const settle = (result: boolean | string | null) => {
    if (!pending) return;
    if (pending.kind === "confirm") pending.resolve(result as boolean);
    else pending.resolve(result as string | null);
    setPending(null);
  };
  const cancelValue = () => (pending?.kind === "confirm" ? false : null);

  return (
    <Ctx.Provider value={{ confirm, prompt }}>
      {children}
      {pending && (
        <Modal
          title={pending.opts.title}
          subtitle={pending.opts.message}
          onClose={() => settle(cancelValue())}
        >
          {pending.kind === "prompt" && (
            <Field label={pending.opts.fieldLabel ?? "Value"}>
              <input
                className="input"
                autoFocus
                value={value}
                placeholder={pending.opts.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && value.trim()) settle(value);
                }}
              />
            </Field>
          )}
          <div className="actions">
            <Button onClick={() => settle(cancelValue())}>
              {pending.kind === "confirm"
                ? (pending.opts.cancelLabel ?? "Cancel")
                : "Cancel"}
            </Button>
            <Button
              variant={
                pending.kind === "confirm" && pending.opts.danger
                  ? "danger"
                  : "primary"
              }
              disabled={pending.kind === "prompt" && !value.trim()}
              onClick={() => settle(pending.kind === "confirm" ? true : value)}
            >
              {pending.opts.confirmLabel ??
                (pending.kind === "confirm" ? "Confirm" : "Save")}
            </Button>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}

export const useDialogs = (): Dialogs => useContext(Ctx);
