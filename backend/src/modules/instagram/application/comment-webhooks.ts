import { ApplicationError } from "../../../shared/application/application-error";

export type CommentNotification = {
  accountExternalId: string;
  mediaExternalId: string;
  commentId: string;
  parentId: string | null;
  sentAt: number;
  text: string | null;
};
export type CommentWebhookPort = {
  connectedAccounts(): Promise<string[]>;
  receive(accountId: string, mediaExternalId: string, id: string, sentAt: number): Promise<void>;
  subscribed(accountId: string): Promise<void>;
  subscribe(accountId: string): Promise<void>;
  digest(value: string): Promise<string>;
  verify(body: ArrayBuffer, signature: string): Promise<boolean>;
};

export class InstagramCommentWebhooks {
  constructor(private readonly port: CommentWebhookPort) {}
  verify(body: ArrayBuffer, signature: string) {
    return this.port.verify(body, signature);
  }

  async receive(notifications: CommentNotification[]) {
    const connected = new Set(await this.port.connectedAccounts());
    for (const event of notifications) {
      const accountId = `ig_${event.accountExternalId}`;
      if (!connected.has(accountId)) continue;
      // The minimal identity handles duplicate deliveries and different batching.
      // Text is hashed only to distinguish edits; neither texts nor authors persist.
      const id = await this.port.digest(
        JSON.stringify([
          accountId,
          event.mediaExternalId,
          event.commentId,
          event.parentId,
          event.sentAt,
          event.text,
        ]),
      );
      await this.port.receive(accountId, event.mediaExternalId, id, event.sentAt);
    }
    return { received: true as const };
  }

  async subscribe(accountId: string) {
    if (!(await this.port.connectedAccounts()).includes(accountId))
      throw new ApplicationError(
        "INSTAGRAM_PERMISSION_REQUIRED",
        "Connect the account with manage_comments before subscribing.",
      );
    await this.port.subscribe(accountId);
    await this.port.subscribed(accountId);
    return { subscribed: true as const };
  }
}
