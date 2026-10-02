import type { InstagramInsight, InstagramMedia, InstagramProfile } from "../public-contracts";

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
  authorizationUrl(state: string): string;
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
}
