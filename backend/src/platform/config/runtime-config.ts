import { ApplicationError } from "../../shared/application/application-error";

export type RuntimeBindings = CloudflareBindings & {
  API_KEY?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  INSTAGRAM_CLIENT_ID?: string;
  INSTAGRAM_CLIENT_SECRET?: string;
};

export function instagramConfig(env: RuntimeBindings) {
  if (!env.INSTAGRAM_CLIENT_ID || !env.INSTAGRAM_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    throw new ApplicationError(
      "CONFIGURATION_REQUIRED",
      "Configure Instagram OAuth and the token encryption key locally.",
    );
  }
  const redirect = new URL(env.INSTAGRAM_REDIRECT_URI);
  if (
    redirect.protocol !== "https:" ||
    (env.ENVIRONMENT !== "development" && ["localhost", "127.0.0.1"].includes(redirect.hostname))
  ) {
    throw new ApplicationError(
      "CONFIGURATION_REQUIRED",
      "Configure an HTTPS Instagram callback URL.",
    );
  }
  if (!/^v\d+\.0$/.test(env.INSTAGRAM_API_VERSION)) {
    throw new ApplicationError(
      "CONFIGURATION_REQUIRED",
      "Configure a supported Instagram API version.",
    );
  }
  return {
    clientId: env.INSTAGRAM_CLIENT_ID,
    clientSecret: env.INSTAGRAM_CLIENT_SECRET,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    redirectUri: redirect.toString(),
    apiVersion: env.INSTAGRAM_API_VERSION,
  };
}
