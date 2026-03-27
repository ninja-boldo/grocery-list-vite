import * as FileSystem from "expo-file-system";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const SESSION_FILE = `${FileSystem.documentDirectory ?? ""}scanner-auth-session.json`;

type AuthSessionContextValue = {
  jwtToken: string | null;
  username: string | null;
  isRestored: boolean;
  setSession: (jwtToken: string | null, username: string | null) => void;
  clearSession: () => void;
};

type StoredSession = {
  jwtToken?: string | null;
  username?: string | null;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

const normalizeToken = (token: string | null) => {
  if (!token || token === "null" || token === "undefined") {
    return null;
  }
  return token;
};

const normalizeUsername = (value: string | null) => {
  if (!value || value === "null" || value === "undefined") {
    return null;
  }
  return value;
};

const canUseFileStorage = () => Boolean(FileSystem.documentDirectory);

const loadPersistedSession = async (): Promise<StoredSession> => {
  if (!canUseFileStorage()) return {};

  try {
    const info = await FileSystem.getInfoAsync(SESSION_FILE);
    if (!info.exists) return {};

    const raw = await FileSystem.readAsStringAsync(SESSION_FILE);
    const parsed = JSON.parse(raw) as StoredSession;
    return {
      jwtToken: normalizeToken(parsed.jwtToken ?? null),
      username: normalizeUsername(parsed.username ?? null),
    };
  } catch (error) {
    console.warn("Failed to restore auth session", error);
    return {};
  }
};

const persistSession = async (
  jwtToken: string | null,
  username: string | null,
) => {
  if (!canUseFileStorage()) return;

  try {
    if (!jwtToken && !username) {
      const info = await FileSystem.getInfoAsync(SESSION_FILE);
      if (info.exists) {
        await FileSystem.deleteAsync(SESSION_FILE, { idempotent: true });
      }
      return;
    }

    const payload: StoredSession = { jwtToken, username };
    await FileSystem.writeAsStringAsync(SESSION_FILE, JSON.stringify(payload));
  } catch (error) {
    console.warn("Failed to persist auth session", error);
  }
};

export const AuthSessionProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [jwtToken, setJwtToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [isRestored, setIsRestored] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const restore = async () => {
      const restored = await loadPersistedSession();
      if (!isMounted) return;

      setJwtToken(normalizeToken(restored.jwtToken ?? null));
      setUsername(normalizeUsername(restored.username ?? null));
      setIsRestored(true);
    };

    void restore();

    return () => {
      isMounted = false;
    };
  }, []);

  const setSession = useCallback(
    (incomingJwtToken: string | null, incomingUsername: string | null) => {
      const nextToken = normalizeToken(incomingJwtToken);
      const nextUsername = normalizeUsername(incomingUsername);

      setJwtToken(nextToken);
      setUsername(nextUsername);
      void persistSession(nextToken, nextUsername);
    },
    [],
  );

  const clearSession = useCallback(() => {
    setJwtToken(null);
    setUsername(null);
    void persistSession(null, null);
  }, []);

  const value = useMemo(
    () => ({ jwtToken, username, isRestored, setSession, clearSession }),
    [clearSession, isRestored, jwtToken, setSession, username],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
};

export const useAuthSession = () => {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used inside AuthSessionProvider");
  }
  return context;
};
