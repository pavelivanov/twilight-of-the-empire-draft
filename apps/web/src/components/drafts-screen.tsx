import { useEffect, useState } from "react";
import { ArrowRight, FilePlus2, FolderOpen, Trash2, UsersRound } from "lucide-react";
import { toast } from "sonner";
import type { DraftStatus, PublicDraft, PublicDraftSummary } from "@imperium/domain";

import { Brand } from "@/components/brand";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const statusLabels: Record<DraftStatus, string> = {
  SETUP: "Setup",
  DRAFTING: "In progress",
  COMPLETE: "Complete",
  ARCHIVED: "Archived",
};

function statusVariant(status: DraftStatus): "default" | "secondary" | "outline" | "ghost" {
  if (status === "DRAFTING") return "default";
  if (status === "COMPLETE") return "secondary";
  if (status === "ARCHIVED") return "ghost";
  return "outline";
}

function updatedLabel(updatedAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(updatedAt).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(new Date(updatedAt));
}

export function DraftsScreen({
  currentDraft,
  onOpen,
  onNew,
  onReturnCurrent,
  onDeleted,
}: {
  currentDraft?: PublicDraft;
  onOpen: (slug: string) => Promise<void>;
  onNew: () => void;
  onReturnCurrent: () => void;
  onDeleted: (slug: string) => void;
}) {
  const [drafts, setDrafts] = useState<PublicDraftSummary[]>();
  const [openingSlug, setOpeningSlug] = useState<string>();
  const [deletingSlug, setDeletingSlug] = useState<string>();

  useEffect(() => {
    let active = true;
    api
      .listDrafts()
      .then((items) => active && setDrafts(items))
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : "Could not load drafts");
      });
    return () => {
      active = false;
    };
  }, []);

  async function openDraft(slug: string) {
    setOpeningSlug(slug);
    try {
      await onOpen(slug);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open draft");
    } finally {
      setOpeningSlug(undefined);
    }
  }

  async function deleteDraft(draft: PublicDraftSummary) {
    setDeletingSlug(draft.slug);
    try {
      await api.deleteDraft(draft.slug);
      setDrafts((items) => items?.filter((item) => item.slug !== draft.slug));
      onDeleted(draft.slug);
      toast.success(`${draft.title} deleted`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete draft");
    } finally {
      setDeletingSlug(undefined);
    }
  }

  return (
    <main className="drafts-shell">
      <header className="setup-header drafts-header">
        <Brand />
        <div className="drafts-header-actions">
          {currentDraft ? (
            <Button className="hidden sm:inline-flex" variant="ghost" onClick={onReturnCurrent}>
              Return to draft
            </Button>
          ) : null}
          <Button onClick={onNew}>
            <FilePlus2 data-icon="inline-start" aria-hidden="true" />
            New draft
          </Button>
        </div>
      </header>

      <section className="drafts-intro">
        <span className="eyebrow">Draft control</span>
        <h1>Your drafts</h1>
        <p>Open a table, check its readiness, or remove a draft you no longer need.</p>
      </section>

      <section className="drafts-list" aria-label="Created drafts">
        {drafts === undefined ? (
          Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="draft-row draft-row-skeleton">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))
        ) : drafts.length === 0 ? (
          <Empty className="drafts-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpen aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No drafts yet</EmptyTitle>
              <EmptyDescription>Create a table for 3–6 players and invite everyone when it is ready.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={onNew}>
                <FilePlus2 data-icon="inline-start" aria-hidden="true" />
                Create draft
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          drafts.map((draft) => {
            const isCurrent = currentDraft?.slug === draft.slug;
            return (
              <article key={draft.id} className={cn("draft-row", isCurrent && "is-current")}>
                <button
                  type="button"
                  className="draft-row-main"
                  disabled={Boolean(openingSlug)}
                  onClick={() => openDraft(draft.slug)}
                >
                  <span className="draft-row-title">
                    <strong>{draft.title}</strong>
                    {isCurrent ? <small>Current</small> : null}
                  </span>
                  <span className="draft-row-meta">
                    <Badge variant={statusVariant(draft.status)}>{statusLabels[draft.status]}</Badge>
                    <span>
                      <UsersRound aria-hidden="true" />
                      {draft.claimedPlayerCount}/{draft.playerCount} claimed
                    </span>
                    <time dateTime={draft.updatedAt}>Updated {updatedLabel(draft.updatedAt)}</time>
                  </span>
                  <ArrowRight aria-hidden="true" />
                </button>

                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={Boolean(deletingSlug)}
                        aria-label={`Delete ${draft.title}`}
                      />
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogMedia>
                        <Trash2 aria-hidden="true" />
                      </AlertDialogMedia>
                      <AlertDialogTitle>Delete “{draft.title}”?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently removes the player list, generated pool, picks, and activity history.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep draft</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => deleteDraft(draft)}>
                        Delete draft
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}
