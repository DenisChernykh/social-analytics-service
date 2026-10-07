import type { CommentPage } from "../../instagram/public-contracts";
import type { CommentCollection, CommentOwnership, SavedComment } from "../domain/model";
export interface CommentStore {
  collection(id: string): Promise<CommentCollection | null>;
  reserve(collection: CommentCollection): Promise<boolean>;
  finish(
    collection: CommentCollection,
    comments: SavedComment[],
    now: number,
    ownership?: CommentOwnership,
  ): Promise<boolean>;
  repeatedPage(collection: CommentCollection): Promise<boolean>;
  freshness(mediaId: string): Promise<{
    uniqueSaved: number;
    lastAttemptAt: number | null;
    lastCompleteAt: number | null;
    nextRefreshAt: number | null;
    omittedReplyBranches: number;
    errorCode: string | null;
  }>;
  list(
    mediaId: string,
    cursor: { time: number; id: string } | null,
    limit: number,
  ): Promise<SavedComment[]>;
  comment(id: string): Promise<SavedComment | null>;
  rootCommentIds(mediaId: string, ids: string[]): Promise<string[]>;
  erase(mediaId: string): Promise<void>;
}
export interface CommentSource {
  media(id: string): Promise<{ accountId: string; externalId: string; permalink: string }>;
  read(
    accountId: string,
    objectId: string,
    replies: boolean,
    cursor: string | null,
    limit: number,
    expandReplies?: boolean,
  ): Promise<CommentPage>;
}
