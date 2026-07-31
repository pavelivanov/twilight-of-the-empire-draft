import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import type { PublicDraft } from "@imperium/domain";

import { DraftScreen } from "@/components/draft-screen";
import { DraftsScreen } from "@/components/drafts-screen";
import { LobbyScreen } from "@/components/lobby-screen";
import { SetupScreen } from "@/components/setup-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import "./index.css";

function App() {
  const [draft, setDraft] = useState<PublicDraft>();
  const [loading, setLoading] = useState(true);
  const telegram = window.Telegram?.WebApp;
  const [initialDraftId] = useState(
    () => telegram?.initDataUnsafe?.start_param ?? new URLSearchParams(window.location.search).get("draft"),
  );
  const [screen, setScreen] = useState<"drafts" | "create" | "draft">(
    initialDraftId ? "draft" : "drafts",
  );

  const acceptDraft = useCallback((nextDraft: PublicDraft) => {
    setDraft(nextDraft);
    setScreen("draft");
    localStorage.setItem("imperium-last-draft", nextDraft.slug);
    const url = new URL(window.location.href);
    url.searchParams.set("draft", nextDraft.slug);
    window.history.replaceState({}, "", url);
  }, []);

  useEffect(() => {
    telegram?.ready();
    telegram?.setHeaderColor?.("#080a10");
    telegram?.setBackgroundColor?.("#080a10");
    telegram?.setBottomBarColor?.("#080a10");
    telegram?.enableClosingConfirmation?.();
    telegram?.disableVerticalSwipes?.();
    telegram?.expand();
    if (telegram?.isVersionAtLeast?.("8.0")) {
      telegram.requestFullscreen?.();
    }
  }, [telegram]);

  useEffect(() => {
    if (!initialDraftId) {
      setLoading(false);
      return;
    }
    let active = true;
    api
      .getDraft(initialDraftId)
      .then((value) => active && acceptDraft(value))
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
  }, [acceptDraft, initialDraftId]);

  useEffect(() => {
    if (screen !== "draft" || !draft || draft.status === "COMPLETE") return;
    const timer = window.setInterval(() => {
      api.getDraft(draft.slug).then(setDraft).catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [acceptDraft, draft, screen]);

  const showDrafts = useCallback(() => {
    setScreen("drafts");
    const url = new URL(window.location.href);
    url.searchParams.delete("draft");
    window.history.replaceState({}, "", url);
  }, []);

  const showNewDraft = useCallback(() => {
    setScreen("create");
    const url = new URL(window.location.href);
    url.searchParams.delete("draft");
    window.history.replaceState({}, "", url);
  }, []);

  async function openDraft(slug: string) {
    const selectedDraft = await api.getDraft(slug);
    acceptDraft(selectedDraft);
  }

  function handleDeleted(slug: string) {
    if (draft?.slug !== slug) return;
    setDraft(undefined);
    if (localStorage.getItem("imperium-last-draft") === slug) {
      localStorage.removeItem("imperium-last-draft");
    }
  }

  if (loading) {
    return (
      <main className="loading-shell">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-80 w-full" />
      </main>
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
        <SetupScreen onCreated={acceptDraft} onCancel={showDrafts} />
      ) : draft?.status === "SETUP" ? (
        <LobbyScreen draft={draft} onDraft={acceptDraft} onShowDrafts={showDrafts} />
      ) : draft ? (
        <DraftScreen draft={draft} onDraft={acceptDraft} onShowDrafts={showDrafts} />
      ) : (
        <DraftsScreen
          onOpen={openDraft}
          onNew={showNewDraft}
          onReturnCurrent={() => undefined}
          onDeleted={handleDeleted}
        />
      )}
      <Toaster richColors position="top-center" />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
