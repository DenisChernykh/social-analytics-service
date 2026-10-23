import {
  ApplicationError,
  incompleteOperationError,
} from "../../../shared/application/application-error";
import { type CommentCheckpoint, commentPolicy } from "../domain/comment-policy";
import type { CollectionJob, CommentPosition } from "../domain/model";
import type { CollectionComments, CollectionStore } from "./ports";

export async function advanceComments(
  job: CollectionJob,
  operationId: string,
  store: CollectionStore,
  comments: CollectionComments,
  leaseToken: string,
  now: number,
) {
  const position: CommentPosition = job.cursor
    ? JSON.parse(job.cursor)
    : {
        version: 2,
        afterMedia: null,
        current: null,
        commentCursor: null,
        parents: [],
        replyCursor: null,
      };
  position.current ??= await store.nextCommentMedia(
    job.accountId,
    position.afterMedia,
    job.startedAt,
    now,
  );
  if (!position.current) return { cursor: null, collected: 0, mediaProcessed: 0, skippedMedia: 0 };
  position.eventGeneration ??= await store.commentGeneration(position.current.id);
  position.omittedBranches ??= 0;
  position.unverifiedParents ??= [];
  position.verifiedParents ??= [];
  // Preserve the selected publication on a first-page failure or interruption.
  job.cursor = JSON.stringify(position);
  const checkpoint: CommentCheckpoint = {
    ...position.current,
    mediaId: position.current.id,
    complete: false,
    omittedBranches: position.omittedBranches,
    eventGeneration: position.eventGeneration,
  };
  const parentId = position.parents[0] ?? null;
  const finishBranch = () => {
    position.parents.shift();
    position.replyCursor = position.branchCursors?.[position.parents[0] ?? ""] ?? null;
  };
  let collected = 0,
    skippedMedia = 0;
  if (parentId && !(await comments.isRootComment(position.current.id, parentId))) {
    finishBranch();
  } else {
    const cursor = parentId ? position.replyCursor : position.commentCursor;
    try {
      const saved = await comments.savedCollection(operationId);
      const page = await comments.collect(position.current.id, {
        operationId,
        parentId,
        cursor,
        limit:
          saved?.limit ?? (parentId ? commentPolicy.replyPageSize : commentPolicy.outerPageSize),
        expandReplies: saved ? (saved.expandedReplies ?? false) : !parentId,
        ownership: { jobId: job.id, leaseToken },
      });
      if (page.status !== "completed") throw incompleteOperationError(page.status, page.errorCode);
      if (page.nextCursor && page.nextCursor === cursor)
        throw new ApplicationError(
          "INSTAGRAM_PAGINATION_STALLED",
          "Instagram repeated its comment cursor.",
        );
      collected = page.collected;
      if (parentId) {
        position.replyCursor = page.nextCursor;
        if (!page.nextCursor) {
          if (!position.verifiedParents.includes(parentId)) position.verifiedParents.push(parentId);
          if (position.unverifiedParents.includes(parentId)) {
            position.omittedBranches = Math.max(0, position.omittedBranches - 1);
            position.unverifiedParents = position.unverifiedParents.filter((id) => id !== parentId);
          }
          finishBranch();
        }
      } else {
        position.commentCursor = page.nextCursor;
        if (page.replyBranches) {
          position.version = 2;
          const omitted = page.replyBranches.filter(
            (branch) =>
              branch.status === "omitted" &&
              !position.verifiedParents?.includes(branch.parentId) &&
              !position.unverifiedParents?.includes(branch.parentId),
          );
          position.omittedBranches += omitted.length;
          // Expansion omission is not evidence of an empty replies edge.
          // Queue every omitted parent, including on later outer pages. The
          // cursor persists the queue; each advance still reads one source page.
          const probes = omitted;
          position.unverifiedParents.push(...probes.map((branch) => branch.parentId));
          position.parents = [
            ...page.replyBranches.filter((branch) => branch.status === "partial"),
            ...probes,
          ].map((branch) => branch.parentId);
          position.branchCursors = Object.fromEntries(
            page.replyBranches.map((branch) => [branch.parentId, branch.nextCursor]),
          );
          position.replyCursor = position.branchCursors[position.parents[0] ?? ""] ?? null;
        } else {
          // Legacy page operations did not request expansion. Keep their saved
          // continuations usable instead of silently skipping reply history.
          position.parents = await comments.rootCommentIds(position.current.id, page.commentIds);
        }
      }
    } catch (error) {
      if (!(error instanceof ApplicationError) || error.code !== "INSTAGRAM_OBJECT_UNAVAILABLE")
        throw error;
      if (parentId) {
        if (!position.unverifiedParents.includes(parentId)) {
          position.omittedBranches++;
          position.unverifiedParents.push(parentId);
        }
        finishBranch();
      } else {
        checkpoint.unavailableUntil = now + 24 * 3_600_000;
        checkpoint.errorCode = error.code;
        position.parents = [];
        position.commentCursor = null;
        skippedMedia = 1;
      }
    }
  }
  let mediaProcessed = 0;
  checkpoint.omittedBranches = position.omittedBranches;
  if (!position.parents.length && !position.commentCursor) {
    mediaProcessed = 1;
    checkpoint.complete = !skippedMedia;
    position.afterMedia = position.current;
    position.current = job.targetMediaId
      ? null
      : await store.nextCommentMedia(job.accountId, position.afterMedia, job.startedAt, now);
    position.eventGeneration = undefined;
    position.omittedBranches = 0;
    position.unverifiedParents = [];
    position.verifiedParents = [];
    position.replyCursor = null;
    position.branchCursors = {};
  }
  return {
    cursor: position.current ? JSON.stringify(position) : null,
    collected,
    mediaProcessed,
    skippedMedia,
    checkpoint,
  };
}
