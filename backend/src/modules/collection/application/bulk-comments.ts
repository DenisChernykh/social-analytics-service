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
  );
  if (!position.current) return { cursor: null, collected: 0, mediaProcessed: 0 };
  position.eventGeneration ??= await store.commentGeneration(position.current.id);
  position.omittedBranches ??= 0;
  // Save the selected publication even if the source call fails on its first page.
  // On interruption the completed page operation supplies the atomic checkpoint.
  job.cursor = JSON.stringify(position);
  const checkpoint: CommentCheckpoint = {
    ...position.current,
    mediaId: position.current.id,
    complete: false,
    omittedBranches: position.omittedBranches,
    eventGeneration: position.eventGeneration,
  };
  const parentId = position.parents[0] ?? null;
  let collected = 0;
  if (parentId && !(await comments.isRootComment(position.current.id, parentId))) {
    position.parents.shift();
    position.replyCursor = position.branchCursors?.[position.parents[0] ?? ""] ?? null;
  } else {
    const cursor = parentId ? position.replyCursor : position.commentCursor;
    const saved = await comments.savedCollection(operationId);
    const page = await comments.collect(position.current.id, {
      operationId,
      parentId,
      cursor,
      limit: saved?.limit ?? (parentId ? commentPolicy.replyPageSize : commentPolicy.outerPageSize),
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
        position.parents.shift();
        position.replyCursor = position.branchCursors?.[position.parents[0] ?? ""] ?? null;
      }
    } else {
      position.commentCursor = page.nextCursor;
      if (page.replyBranches) {
        position.version = 2;
        position.omittedBranches += page.replyBranches.filter(
          (branch) => branch.status === "omitted",
        ).length;
        position.parents = page.replyBranches
          .filter((branch) => branch.status === "partial")
          .map((branch) => branch.parentId);
        position.branchCursors = Object.fromEntries(
          page.replyBranches.map((branch) => [branch.parentId, branch.nextCursor]),
        );
        position.replyCursor = position.branchCursors[position.parents[0] ?? ""] ?? null;
      } else {
        position.parents = await comments.rootCommentIds(position.current.id, page.commentIds);
      }
    }
  }
  let mediaProcessed = 0;
  checkpoint.omittedBranches = position.omittedBranches;
  if (!position.parents.length && !position.commentCursor) {
    mediaProcessed = 1;
    checkpoint.complete = true;
    position.afterMedia = position.current;
    position.current = job.targetMediaId
      ? null
      : await store.nextCommentMedia(job.accountId, position.afterMedia, job.startedAt);
    position.eventGeneration = undefined;
    checkpoint.omittedBranches = position.omittedBranches;
    position.omittedBranches = 0;
    position.replyCursor = null;
    position.branchCursors = {};
  }
  return {
    cursor: position.current ? JSON.stringify(position) : null,
    collected,
    mediaProcessed,
    checkpoint,
  };
}
