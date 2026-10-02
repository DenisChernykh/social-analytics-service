export type InstagramProfile = {
  userId: string;
  username: string;
  accountType: string;
  followersCount: number | null;
  mediaCount: number | null;
};
export type InstagramMedia = {
  id: string;
  caption: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  productType: string;
  permalink: string;
  timestamp: number;
  likeCount: number | null;
  commentsCount: number | null;
};
export type InstagramInsight = {
  value: number | null;
  reason: "not_returned" | "not_supported" | "permission_required" | "invalid_value" | null;
};
export interface InstagramReader {
  profile(accountId: string): Promise<InstagramProfile>;
  mediaPage(
    accountId: string,
    userId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ media: InstagramMedia[]; nextCursor: string | null }>;
  insights(
    accountId: string,
    mediaId: string,
    fields: string[],
  ): Promise<Record<string, InstagramInsight>>;
}
