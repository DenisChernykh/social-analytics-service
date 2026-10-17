import type {
  CommentPage,
  InsightBatchQuery,
  InsightQuery,
  InstagramApiStatus,
  InstagramInsight,
  InstagramMedia,
  InstagramProfile,
  StructuredInsight,
} from "../public-contracts";

export type StoredConnection = {
  accountId: string;
  encryptedToken: string;
  expiresAt: number;
  refreshedAt: number;
  scopes: string[];
};
export interface ConnectionRepository {
  saveState(hash: string, expiresAt: number, now: number): Promise<void>;
  consumeState(hash: string, now: number): Promise<boolean>;
  save(profile: InstagramProfile, connection: StoredConnection, now: number): Promise<void>;
  get(accountId: string): Promise<StoredConnection | null>;
  list(): Promise<Array<Omit<StoredConnection, "encryptedToken">>>;
  updateToken(
    accountId: string,
    encryptedToken: string,
    expiresAt: number,
    now: number,
  ): Promise<void>;
  disconnect(accountId: string): Promise<void>;
}
export interface TokenProtection {
  encrypt(value: string, accountId: string): Promise<string>;
  decrypt(value: string, accountId: string): Promise<string>;
}
export interface InstagramTransport {
  requestStats?(): { attempts: number };
  forOperation?(operationId: string): InstagramTransport;
  forAccount?(accountId: string): InstagramTransport;
  subscribeComments(token: string, userId: string): Promise<void>;
  authorizationUrl(state: string, comments?: boolean): string;
  exchangeCode(code: string): Promise<{ accessToken: string; scopes: string[] }>;
  extendToken(token: string): Promise<{ accessToken: string; expiresIn: number }>;
  refreshToken(token: string): Promise<{ accessToken: string; expiresIn: number }>;
  profile(token: string): Promise<InstagramProfile>;
  mediaPage(
    token: string,
    userId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ media: InstagramMedia[]; nextCursor: string | null }>;
  insights(
    token: string,
    mediaId: string,
    fields: string[],
  ): Promise<Record<string, InstagramInsight>>;
  media(token: string, mediaId: string): Promise<InstagramMedia>;
  stories(
    token: string,
    userId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ media: InstagramMedia[]; nextCursor: string | null }>;
  structuredInsights(
    token: string,
    objectId: string,
    query: InsightQuery,
  ): Promise<StructuredInsight>;
  structuredInsightsBatch?(
    token: string,
    objectId: string,
    query: InsightBatchQuery,
  ): Promise<StructuredInsight[]>;
  comments(
    token: string,
    objectId: string,
    replies: boolean,
    cursor: string | null,
    limit: number,
    expandReplies?: boolean,
  ): Promise<CommentPage>;
}

export interface InstagramRequestPolicy {
  status(accountId: string, apiVersion: string, now: number): Promise<InstagramApiStatus>;
  beginAttempt?(attempt: HttpAttempt): Promise<void>;
  finishAttempt?(
    attempt: HttpAttempt,
    usage: ReturnType<typeof import("../domain/request-policy").quotaObservation>,
  ): Promise<void>;

  observe(
    accountId: string,
    apiVersion: string,
    now: number,
    usagePercent: number | null,
    blockedUntil: number,
  ): Promise<void>;
  unsupported(
    accountId: string,
    apiVersion: string,
    objectId: string,
    signature: string,
    now: number,
  ): Promise<string[]>;
  rememberUnsupported(
    accountId: string,
    apiVersion: string,
    objectId: string,
    signature: string,
    fields: string[],
    now: number,
  ): Promise<void>;
}

export type HttpAttempt = {
  id: string;
  accountId: string;
  operationId: string | null;
  objectId: string | null;
  endpointFamily: string;
  parameters: Record<string, string>;
  requestStartedAt: number;
  responseReceivedAt: number | null;
  failedAt: number | null;
  requestedApiVersion: string;
  actualApiVersion: string | null;
  login: "instagram_login";
  httpStatus: number | null;
  graphCode: number | null;
  graphSubcode: number | null;
  result:
    | "pending"
    | "success"
    | "not_supported"
    | "invalid_request"
    | "invalid_breakdown"
    | "permission_required"
    | "insufficient_audience"
    | "object_unavailable"
    | "rate_limited"
    | "retryable"
    | "source_error"
    | "transport_error"
    | "timeout";
  sample: string | null;
};
