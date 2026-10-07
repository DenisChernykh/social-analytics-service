import { ApplicationError } from "../../../shared/application/application-error";
import type { InsightQuery, InstagramReader } from "../public-contracts";
import type { ConnectionRepository, InstagramTransport, TokenProtection } from "./ports";

export class InstagramConnections implements InstagramReader {
  private readonly tokens = new Map<string, Promise<string>>();
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly transport: InstagramTransport,
    private readonly cipher: TokenProtection,
    private readonly clock: () => number,
  ) {}

  async start(state: string, hash: string, comments = false) {
    const now = this.clock();
    const expiresAt = now + 10 * 60_000;
    await this.repository.saveState(hash, expiresAt, now);
    return { authorizationUrl: this.transport.authorizationUrl(state, comments), expiresAt };
  }

  async callback(input: { stateHash: string; code?: string; denied: boolean }) {
    if (!(await this.repository.consumeState(input.stateHash, this.clock()))) {
      throw new ApplicationError(
        "INVALID_OAUTH_STATE",
        "Start a new Instagram authorization; this link has expired or was already used.",
      );
    }
    if (input.denied)
      throw new ApplicationError("OAUTH_DENIED", "Instagram authorization was declined.");
    if (!input.code)
      throw new ApplicationError(
        "VALIDATION_FAILED",
        "The OAuth callback requires an authorization code.",
      );
    const short = await this.transport.exchangeCode(input.code);
    if (short.scopes.length && !short.scopes.includes("instagram_business_manage_insights")) {
      throw new ApplicationError(
        "INSTAGRAM_PERMISSION_REQUIRED",
        "Grant instagram_business_manage_insights when connecting Instagram.",
      );
    }
    const long = await this.transport.extendToken(short.accessToken);
    const profile = await this.transport.profile(long.accessToken);
    const accountId = `ig_${profile.userId}`;
    const now = this.clock();
    await this.repository.save(
      profile,
      {
        accountId,
        encryptedToken: await this.cipher.encrypt(long.accessToken, accountId),
        expiresAt: now + long.expiresIn * 1000,
        refreshedAt: now,
        scopes: short.scopes,
      },
      now,
    );
    return { accountId, username: profile.username, expiresAt: now + long.expiresIn * 1000 };
  }

  list() {
    return this.repository.list();
  }
  async disconnect(accountId: string) {
    if (!(await this.repository.get(accountId)))
      throw new ApplicationError("NOT_FOUND", "The Instagram connection was not found.");
    await this.repository.disconnect(accountId);
  }

  private async loadToken(accountId: string): Promise<string> {
    const connection = await this.repository.get(accountId);
    if (!connection)
      throw new ApplicationError("NOT_FOUND", "The Instagram connection was not found.");
    const now = this.clock();
    if (connection.expiresAt <= now)
      throw new ApplicationError(
        "INSTAGRAM_AUTH_EXPIRED",
        "Reconnect Instagram; the access token has expired.",
      );
    const token = await this.cipher.decrypt(connection.encryptedToken, accountId);
    if (connection.expiresAt - now > 7 * 86_400_000 || now - connection.refreshedAt < 86_400_000)
      return token;
    const refreshed = await this.transport.refreshToken(token);
    await this.repository.updateToken(
      accountId,
      await this.cipher.encrypt(refreshed.accessToken, accountId),
      now + refreshed.expiresIn * 1000,
      now,
    );
    return refreshed.accessToken;
  }

  private token(accountId: string) {
    let pending = this.tokens.get(accountId);
    if (!pending) {
      pending = this.loadToken(accountId);
      this.tokens.set(accountId, pending);
    }
    return pending;
  }
  async profile(accountId: string) {
    return this.transport.profile(await this.token(accountId));
  }
  async mediaPage(accountId: string, userId: string, cursor: string | null, limit: number) {
    return this.transport.mediaPage(await this.token(accountId), userId, cursor, limit);
  }
  async insights(accountId: string, mediaId: string, fields: string[]) {
    return this.transport.insights(await this.token(accountId), mediaId, fields);
  }
  async media(accountId: string, mediaId: string) {
    return this.transport.media(await this.token(accountId), mediaId);
  }
  async stories(accountId: string, userId: string, cursor: string | null, limit: number) {
    return this.transport.stories(await this.token(accountId), userId, cursor, limit);
  }
  async structuredInsights(accountId: string, objectId: string, query: InsightQuery) {
    return this.transport.structuredInsights(await this.token(accountId), objectId, query);
  }
  async comments(
    accountId: string,
    objectId: string,
    replies: boolean,
    cursor: string | null,
    limit: number,
    expandReplies = false,
  ) {
    const connection = await this.repository.get(accountId);
    if (!connection?.scopes.includes("instagram_business_manage_comments"))
      throw new ApplicationError(
        "INSTAGRAM_PERMISSION_REQUIRED",
        "Reconnect Instagram with instagram_business_manage_comments to read comment texts.",
      );
    return this.transport.comments(
      await this.token(accountId),
      objectId,
      replies,
      cursor,
      limit,
      expandReplies,
    );
  }
  async subscribeComments(accountId: string) {
    const connection = await this.repository.get(accountId);
    const externalId = accountId.match(/^ig_(\d+)$/)?.[1];
    if (!externalId || !connection?.scopes.includes("instagram_business_manage_comments"))
      throw new ApplicationError(
        "INSTAGRAM_PERMISSION_REQUIRED",
        "Grant manage_comments before subscribing to comment notifications.",
      );
    await this.transport.subscribeComments(await this.token(accountId), externalId);
  }
}
