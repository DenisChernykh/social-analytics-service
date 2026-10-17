import type { OpenAPIHono } from "@hono/zod-openapi";
import type { HttpEnv } from "../platform/http/environment";

const contact = "sharper.togas-6q@icloud.com";
const privacy = `Social Analytics — Privacy Policy
Updated: 3 October 2026

Social Analytics is a personal analytics service for social accounts managed by its owner. Instagram is the first connected platform. The service uses the official Instagram API with the account owner's authorization.

Data collected
The service stores the connected account's ID, username, account type, follower and publication counts; publication IDs, captions, links and dates; available performance metrics and the times they were collected; aggregate audience demographics; and comment IDs, texts and dates, author IDs/usernames, like counts and hidden flags when the API makes them available. Limited sanitized request diagnostics are also stored; these do not contain access tokens, authorization headers, signed media URLs or comment texts. The owner may also supply content labels, costs, leads and sales data. OAuth permissions and an encrypted access token are stored to maintain the authorized connection. The service does not request an Instagram password.

Purpose and access
These data support the owner's saved reports, historical comparisons and content analysis. Recurring collection runs when the owner enables it. Access to the statistics is restricted to the owner. The service does not sell these data or use them for advertising.

Service providers
Meta supplies the authorized API data. Cloudflare hosts the backend and its database. When the owner uses the connected Social Analytics tools or card in ChatGPT, the requested report data are processed through OpenAI's ChatGPT and private Sites services. Those providers also apply their own terms and privacy policies.

Retention and controls
Saved analytical history is retained until the owner requests its deletion. Disconnecting an account deletes its stored access token; it retains the saved reports. The owner can also revoke the app's permission in Instagram's connected-app settings. For deletion of stored account data or an individual saved comment, follow https://api.social-insights.workers.dev/data-deletion or contact ${contact}. Do not send passwords, access tokens or API keys.

Contact
Questions about this service's data handling: ${contact}.
`;

const deletion = `Social Analytics — Data Deletion Instructions
Updated: 3 October 2026

To stop new access to an Instagram account, disconnect it in Social Analytics or revoke the app's permission in Instagram's connected-app settings. Disconnecting removes the service's stored access token; previously saved analytical data remain until deletion is requested.

To request deletion of data saved by Social Analytics, contact ${contact}. State that the request concerns Social Analytics and identify the relevant account by its username or account ID. For a request about a saved comment, include its public publication link and enough information to identify the comment. Do not send an Instagram password, access token or API key.

The service owner verifies the request and removes the corresponding saved data from the service's database. Deleting the service's stored account data removes its connection, publication and profile history, audience observations, comments and associated analytical records. It does not delete the original account, posts or comments from Instagram. Data already included in a ChatGPT conversation are managed separately through that conversation's data controls.
`;

export function registerPublicInformation(app: OpenAPIHono<HttpEnv>) {
  app.get("/privacy-policy", (c) => c.text(privacy));
  app.get("/data-deletion", (c) => c.text(deletion));
}
