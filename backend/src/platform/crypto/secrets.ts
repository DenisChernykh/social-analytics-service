import { ApplicationError } from "../../shared/application/application-error";

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function randomState(): string {
  return encode(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export class TokenCipher {
  constructor(private readonly secret: string) {}

  private async key() {
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = decode(this.secret);
    } catch {
      throw new ApplicationError(
        "CONFIGURATION_REQUIRED",
        "The token encryption key must be a base64 encoded 32-byte key.",
      );
    }
    if (bytes.length !== 32)
      throw new ApplicationError(
        "CONFIGURATION_REQUIRED",
        "The token encryption key must contain 32 bytes.",
      );
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async encrypt(token: string, accountId: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(accountId) },
      await this.key(),
      new TextEncoder().encode(token),
    );
    return JSON.stringify({ v: 1, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) });
  }

  async decrypt(encrypted: string, accountId: string): Promise<string> {
    const key = await this.key();
    try {
      const envelope = JSON.parse(encrypted) as { v: number; iv: string; ciphertext: string };
      if (envelope.v !== 1) throw new Error("Invalid envelope");
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode(envelope.iv),
          additionalData: new TextEncoder().encode(accountId),
        },
        key,
        decode(envelope.ciphertext),
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      throw new ApplicationError("INSTAGRAM_AUTH_EXPIRED", "Reconnect the Instagram account.");
    }
  }
}
