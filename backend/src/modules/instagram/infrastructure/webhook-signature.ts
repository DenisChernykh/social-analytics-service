export async function verifyWebhookSignature(
  body: ArrayBuffer,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const bytes = Uint8Array.from(signature.slice(7).match(/../g) ?? [], (hex) =>
    Number.parseInt(hex, 16),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, bytes, body);
}
