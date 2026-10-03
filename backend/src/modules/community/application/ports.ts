import type { CommentCollection, SavedComment } from "../domain/model";
export interface CommentStore {
  collection(id: string): Promise<CommentCollection | null>;
  reserve(collection: CommentCollection): Promise<boolean>;
  finish(collection: CommentCollection, comments: SavedComment[]): Promise<void>;
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
  ): Promise<{
    items: { id: string; text: string; publishedAt: number; parentId?: string | null }[];
    nextCursor: string | null;
  }>;
}
