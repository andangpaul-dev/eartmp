/**
 * KeyProvider — tracks whether the transcript signing key is unsealed for this
 * host session. The key is sealed at rest; unsealing needs the institution
 * passphrase and is held only in the host's memory (a lost passphrase is
 * unrecoverable). The topbar chip and the Transcripts screen read this; only a
 * user with `transcripts.generate` can unseal/seal.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useCore, useSession } from "./CoreProvider";

interface KeyState {
  sealed: boolean;
  refresh: () => void;
  unseal: (passphrase: string) => Promise<void>;
  seal: () => Promise<void>;
}

const KeyCtx = createContext<KeyState>({
  sealed: true,
  refresh: () => {},
  unseal: async () => {},
  seal: async () => {},
});

export function KeyProvider({ children }: { children: ReactNode }) {
  const core = useCore();
  const { can } = useSession();
  const [sealed, setSealed] = useState(true);

  const refresh = useCallback(() => {
    if (!can("transcripts.read")) return;
    core
      .keyState({})
      .then((s) => setSealed(s.sealed))
      .catch(() => setSealed(true));
  }, [core, can]);

  useEffect(refresh, [refresh]);

  const unseal = useCallback(
    async (passphrase: string) => {
      const s = await core.unsealKey({ passphrase });
      setSealed(s.sealed);
    },
    [core],
  );
  const seal = useCallback(async () => {
    const s = await core.sealKey({});
    setSealed(s.sealed);
  }, [core]);

  return (
    <KeyCtx.Provider value={{ sealed, refresh, unseal, seal }}>
      {children}
    </KeyCtx.Provider>
  );
}

export const useKeyState = (): KeyState => useContext(KeyCtx);
