import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import type { PublicDraft } from "@imperium/domain";

import { DraftScreen } from "@/components/draft-screen";
import { LobbyScreen } from "@/components/lobby-screen";
import { SetupScreen } from "@/components/setup-screen";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import "./index.css";

function App() {
  const [draft, setDraft] = useState<PublicDraft>();
  const [loading, setLoading] = useState(true);
  const telegram = window.Telegram?.WebApp;
  const draftId =
    telegram?.initDataUnsafe?.start_param ??
    new URLSearchParams(window.location.search).get("draft") ??
    localStorage.getItem("imperium-last-draft");

  const acceptDraft = useCallback((nextDraft: PublicDraft) => {
    setDraft(nextDraft);
    localStorage.setItem("imperium-last-draft", nextDraft.slug);
    const url = new URL(window.location.href);
    url.searchParams.set("draft", nextDraft.slug);
    window.history.replaceState({}, "", url);
  }, []);

  useEffect(() => {
    telegram?.ready();
    telegram?.expand();
    telegram?.setHeaderColor?.("#080a10");
    telegram?.setBackgroundColor?.("#080a10");
    telegram?.setBottomBarColor?.("#080a10");
    telegram?.enableClosingConfirmation?.();
  }, [telegram]);

  useEffect(() => {
    if (!draftId) {
      setLoading(false);
      return;
    }
    let active = true;
    api
      .getDraft(draftId)
      .then((value) => active && acceptDraft(value))
      .catch(() => {
        if (active) localStorage.removeItem("imperium-last-draft");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [acceptDraft, draftId]);

  useEffect(() => {
    if (!draft || draft.status === "COMPLETE") return;
    const timer = window.setInterval(() => {
      api.getDraft(draft.slug).then(acceptDraft).catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [acceptDraft, draft]);

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
      {!draft ? (
        <SetupScreen onCreated={acceptDraft} />
      ) : draft.status === "SETUP" ? (
        <LobbyScreen draft={draft} onDraft={acceptDraft} />
      ) : (
        <DraftScreen draft={draft} onDraft={acceptDraft} />
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
