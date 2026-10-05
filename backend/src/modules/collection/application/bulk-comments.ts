import {
  ApplicationError,
  incompleteOperationError,
} from "../../../shared/application/application-error";
import type { CollectionJob, CommentPosition } from "../domain/model";
import type { CollectionComments, CollectionStore } from "./ports";

export async function advanceComments(
  job: CollectionJob,
  operationId: string,
  store: CollectionStore,
  comments: CollectionComments,
) {
  const position: CommentPosition = job.cursor
    ? JSON.parse(job.cursor)
    : { afterMedia: null, current: null, commentCursor: null, parents: [], replyCursor: null };
  position.current ??= await store.nextCommentMedia(
    job.accountId,
    position.afterMedia,
    job.startedAt,
  );
  if (!position.current) return { cursor: null, collected: 0, mediaProcessed: 0 };
  const parentId = position.parents[0] ?? null;
  let collected = 0;
  if (parentId && !(await comments.isRootComment(position.current.id, parentId))) {
    position.parents.shift();
    position.replyCursor = null;
  } else {
    const cursor = parentId ? position.replyCursor : position.commentCursor;
    const page = await comments.collect(position.current.id, {
      operationId,
      parentId,
      cursor,
      limit: 50,
    });
    if (page.status !== "completed") throw incompleteOperationError(page.status, page.errorCode);
    if (page.nextCursor && page.nextCursor === cursor)
      throw new ApplicationError("INSTAGRAM_UNAVAILABLE", "Instagram repeated its comment cursor.");
    collected = page.collected;
    if (parentId) {
      position.replyCursor = page.nextCursor;
      if (!page.nextCursor) position.parents.shift();
    } else {
      position.commentCursor = page.nextCursor;
      position.parents = await comments.rootCommentIds(position.current.id, page.commentIds);
    }
  }
  let mediaProcessed = 0;
  if (!position.parents.length && !position.commentCursor) {
    mediaProcessed = 1;
    position.afterMedia = position.current;
    position.current = await store.nextCommentMedia(
      job.accountId,
      position.afterMedia,
      job.startedAt,
    );
  }
  return {
    cursor: position.current ? JSON.stringify(position) : null,
    collected,
    mediaProcessed,
  };
}
