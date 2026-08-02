import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import type { PublicDraft } from "@imperium/domain";

import { DraftScreen } from "@/components/draft-screen";
import { BrowserConnectScreen } from "@/components/browser-connect-screen";
import type { DraftView } from "@/components/draft-navigation";
import { DraftsScreen } from "@/components/drafts-screen";
import { LobbyScreen } from "@/components/lobby-screen";
import { SetupScreen } from "@/components/setup-screen";
import { Skeleton } from "@/components/ui/skeleton";
import {
  api,
  clearBrowserSessionToken,
  setBrowserSessionToken,
  type BrowserSessionStart,
} from "@/lib/api";
import { notifyBrowserOfDraftUpdate } from "@/lib/browser-notifications";
import { telegramStartTarget } from "@/lib/telegram-start";
import { mountTelegramViewport } from "@/lib/telegram-viewport";
import "./index.css";

function App() {
  const [draft, setDraft] = useState<PublicDraft>();
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<"checking" | "connecting" | "ready">("checking");
  const [browserSession, setBrowserSession] = useState<BrowserSessionStart>();
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string>();
  const telegram = window.Telegram?.WebApp;
  const [startTarget] = useState(() =>
    telegramStartTarget(telegram?.initDataUnsafe?.start_param, window.location.search),
  );
  const { initialDraftId, telegramLaunchToken } = startTarget;
  const [screen, setScreen] = useState<"drafts" | "create" | "draft">(
    telegramLaunchToken ? "create" : initialDraftId ? "draft" : "drafts",
  );
  const [draftView, setDraftView] = useState<DraftView>("draft");
  const draftStatus = useRef<PublicDraft["status"] | undefined>(undefined);
  const latestDraft = useRef<PublicDraft | undefined>(undefined);

  const beginBrowserSession = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(undefined);
    try {
      const session = await api.beginBrowserSession();
      setBrowserSession(session);
      setAuthStatus("connecting");
    } catch (error) {
      setAuthStatus("connecting");
      setAuthError(error instanceof Error ? error.message : "Could not connect to Telegram");
    } finally {
      setAuthBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    api
      .getCurrentUser()
      .then(() => active && setAuthStatus("ready"))
      .catch(async () => {
        clearBrowserSessionToken();
        if (!active) return;
        try {
          const session = await api.beginBrowserSession();
          if (!active) return;
          setBrowserSession(session);
          setAuthStatus("connecting");
        } catch (error) {
          if (!active) return;
          setAuthError(error instanceof Error ? error.message : "Could not connect to Telegram");
          setAuthStatus("connecting");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authStatus !== "connecting" || !browserSession) return;
    let active = true;
    let timer: number | undefined;
    const check = async () => {
      try {
        const status = await api.getBrowserSessionStatus(browserSession.token);
        if (!active) return;
        if (status.status === "authenticated") {
          setBrowserSessionToken(browserSession.token);
          setAuthError(undefined);
          setAuthStatus("ready");
          return;
        }
        if (status.status === "expired") {
          setBrowserSession(undefined);
          setAuthError("The sign-in link expired. Create a new one to continue.");
          return;
        }
      } catch (error) {
        if (active) setAuthError(error instanceof Error ? error.message : "Could not check the sign-in");
      }
      if (active) timer = window.setTimeout(check, 1_500);
    };
    timer = window.setTimeout(check, 800);
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [authStatus, browserSession]);

  const acceptDraft = useCallback((nextDraft: PublicDraft, resetView = false) => {
    notifyBrowserOfDraftUpdate(latestDraft.current, nextDraft);
    latestDraft.current = nextDraft;
    const previousStatus = draftStatus.current;
    draftStatus.current = nextDraft.status;
    setDraft(nextDraft);
    setScreen("draft");
    if (resetView) setDraftView(nextDraft.status === "SETUP" ? "table" : "draft");
    else if (previousStatus === "SETUP" && nextDraft.status !== "SETUP") setDraftView("draft");
    localStorage.setItem("imperium-last-draft", nextDraft.slug);
    const url = new URL(window.location.href);
    url.searchParams.set("draft", nextDraft.slug);
    url.searchParams.delete("channelLaunch");
    url.searchParams.delete("groupLaunch");
    window.history.replaceState({}, "", url);
  }, []);

  useEffect(() => {
    if (authStatus !== "ready") return;
    if (!initialDraftId) {
      setLoading(false);
      return;
    }
    let active = true;
    api
      .getDraft(initialDraftId)
      .then((value) => active && acceptDraft(value, true))
      .catch(() => {
        if (active) {
          localStorage.removeItem("imperium-last-draft");
          setScreen("drafts");
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [acceptDraft, authStatus, initialDraftId]);

  useEffect(() => {
    if (authStatus !== "ready" || !draft || draft.status === "COMPLETE") return;
    const timer = window.setInterval(() => {
      api.getDraft(draft.slug).then(acceptDraft).catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [acceptDraft, authStatus, draft]);

  const showDrafts = useCallback(() => {
    setScreen("drafts");
    const url = new URL(window.location.href);
    url.searchParams.delete("draft");
    url.searchParams.delete("channelLaunch");
    url.searchParams.delete("groupLaunch");
    window.history.replaceState({}, "", url);
  }, []);

  const showNewDraft = useCallback(() => {
    setScreen("create");
    const url = new URL(window.location.href);
    url.searchParams.delete("draft");
    url.searchParams.delete("channelLaunch");
    url.searchParams.delete("groupLaunch");
    window.history.replaceState({}, "", url);
  }, []);

  async function openDraft(slug: string) {
    const selectedDraft = await api.getDraft(slug);
    acceptDraft(selectedDraft, true);
  }

  function handleDeleted(slug: string) {
    if (draft?.slug !== slug) return;
    setDraft(undefined);
    if (localStorage.getItem("imperium-last-draft") === slug) {
      localStorage.removeItem("imperium-last-draft");
    }
  }

  if (authStatus === "checking" || (authStatus === "ready" && loading)) {
    return (
      <main className="loading-shell">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-80 w-full" />
      </main>
    );
  }

  if (authStatus === "connecting") {
    return (
      <BrowserConnectScreen
        session={browserSession}
        busy={authBusy}
        error={authError}
        onRetry={() => void beginBrowserSession()}
      />
    );
  }

  return (
    <>
      {screen === "drafts" ? (
        <DraftsScreen
          currentDraft={draft}
          onOpen={openDraft}
          onNew={showNewDraft}
          onReturnCurrent={() => draft && acceptDraft(draft)}
          onDeleted={handleDeleted}
        />
      ) : screen === "create" ? (
        <SetupScreen
          telegramLaunchToken={telegramLaunchToken}
          onCreated={(created) => acceptDraft(created, true)}
          onCancel={showDrafts}
        />
      ) : draft?.status === "SETUP" ? (
        <LobbyScreen
          draft={draft}
          onDraft={acceptDraft}
          onShowDrafts={showDrafts}
          view={draftView}
          onViewChange={setDraftView}
        />
      ) : draft ? (
        <DraftScreen
          draft={draft}
          onDraft={acceptDraft}
          onShowDrafts={showDrafts}
          view={draftView}
          onViewChange={setDraftView}
        />
      ) : (
        <DraftsScreen
          onOpen={openDraft}
          onNew={showNewDraft}
          onReturnCurrent={() => undefined}
          onDeleted={handleDeleted}
        />
      )}
      <Toaster
        richColors
        position="top-center"
        offset={{ top: "calc(var(--app-content-inset-top) + 16px)" }}
        mobileOffset={{ top: "calc(var(--app-content-inset-top) + 16px)" }}
      />
    </>
  );
}

const unmountTelegramViewport = mountTelegramViewport();

if (import.meta.hot) {
  import.meta.hot.dispose(unmountTelegramViewport);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
