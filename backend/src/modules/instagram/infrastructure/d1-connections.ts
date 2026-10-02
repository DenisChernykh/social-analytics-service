import { and, eq, gt, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { accounts, instagramConnections, oauthAttempts } from "../../../platform/database/schema";
import type { ConnectionRepository, StoredConnection } from "../application/ports";
import type { InstagramProfile } from "../public-contracts";

export class D1Connections implements ConnectionRepository {
  private readonly db;
  constructor(database: D1Database) {
    this.db = drizzle(database);
  }
  async saveState(hash: string, expiresAt: number, now: number) {
    await this.db.batch([
      this.db.delete(oauthAttempts).where(lte(oauthAttempts.expiresAt, now)),
      this.db.insert(oauthAttempts).values({ stateHash: hash, expiresAt }),
    ]);
  }
  async consumeState(hash: string, now: number) {
    const deleted = await this.db
      .delete(oauthAttempts)
      .where(and(eq(oauthAttempts.stateHash, hash), gt(oauthAttempts.expiresAt, now)))
      .returning();
    return deleted.length === 1;
  }
  async save(profile: InstagramProfile, connection: StoredConnection, now: number) {
    await this.db.batch([
      this.db
        .insert(accounts)
        .values({
          id: connection.accountId,
          platform: "instagram",
          externalId: profile.userId,
          username: profile.username,
          accountType: profile.accountType,
          connectedAt: now,
        })
        .onConflictDoUpdate({
          target: accounts.id,
          set: { username: profile.username, accountType: profile.accountType },
        }),
      this.db
        .insert(instagramConnections)
        .values({ ...connection, scopes: JSON.stringify(connection.scopes) })
        .onConflictDoUpdate({
          target: instagramConnections.accountId,
          set: {
            encryptedToken: connection.encryptedToken,
            expiresAt: connection.expiresAt,
            refreshedAt: connection.refreshedAt,
            scopes: JSON.stringify(connection.scopes),
          },
        }),
    ]);
  }
  async get(accountId: string) {
    const rows = await this.db
      .select()
      .from(instagramConnections)
      .where(eq(instagramConnections.accountId, accountId))
      .limit(1);
    const row = rows[0];
    return row ? { ...row, scopes: JSON.parse(row.scopes) as string[] } : null;
  }
  async list() {
    const rows = await this.db
      .select({
        accountId: instagramConnections.accountId,
        expiresAt: instagramConnections.expiresAt,
        refreshedAt: instagramConnections.refreshedAt,
        scopes: instagramConnections.scopes,
      })
      .from(instagramConnections);
    return rows.map((row) => ({ ...row, scopes: JSON.parse(row.scopes) as string[] }));
  }
  async updateToken(accountId: string, encryptedToken: string, expiresAt: number, now: number) {
    await this.db
      .update(instagramConnections)
      .set({ encryptedToken, expiresAt, refreshedAt: now })
      .where(eq(instagramConnections.accountId, accountId));
  }
  async disconnect(accountId: string) {
    await this.db.delete(instagramConnections).where(eq(instagramConnections.accountId, accountId));
  }
}
