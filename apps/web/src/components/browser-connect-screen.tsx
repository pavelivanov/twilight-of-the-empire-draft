import { ExternalLinkIcon, RefreshCwIcon, SendIcon } from "lucide-react";

import { Brand } from "@/components/brand";
import type { BrowserSessionStart } from "@/lib/api";

export function BrowserConnectScreen({
  session,
  busy,
  error,
  onRetry,
}: {
  session?: BrowserSessionStart;
  busy: boolean;
  error?: string;
  onRetry: () => void;
}) {
  return (
    <main className="connect-shell">
      <header className="connect-topbar">
        <Brand />
        <span>WEB ACCESS</span>
      </header>
      <section className="connect-hero">
        <div className="connect-orbit" aria-hidden="true">
          <i />
          <span><SendIcon /></span>
        </div>
        <div className="mono-label">SAME TABLE · ANY SCREEN</div>
        <h1>Connect this browser to Telegram.</h1>
        <p>Your drafts, claimed seats, and host controls stay attached to the same Telegram identity.</p>
        {session ? (
          <a className="btn-accent connect-action" href={session.botUrl} target="_blank" rel="noreferrer">
            Continue in Telegram
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        ) : (
          <button type="button" className="btn-accent connect-action" disabled={busy} onClick={onRetry}>
            {busy ? "Preparing secure link…" : "Connect Telegram"}
          </button>
        )}
        <div className="connect-status" aria-live="polite">
          <i className={session ? "is-waiting" : ""} />
          <span>
            <strong>{session ? "Waiting for confirmation" : error ? "Could not create the link" : "Secure session"}</strong>
            <small>
              {session
                ? "Tap Start in the bot. This page will sign in automatically."
                : error ?? "Telegram confirms the account; no password is shared with this site."}
            </small>
          </span>
        </div>
        {error && (
          <button type="button" className="connect-retry" disabled={busy} onClick={onRetry}>
            <RefreshCwIcon aria-hidden="true" />
            Try again
          </button>
        )}
      </section>
      <footer className="connect-footer">The link expires in 10 minutes and can connect one browser.</footer>
    </main>
  );
}
