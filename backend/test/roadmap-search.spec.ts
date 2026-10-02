import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { normalizeSearch } from "../src/modules/analytics/domain/search";
import { accountId, connect, fixture } from "./helpers";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM accounts").run();
});

async function seed(id: string, caption: string, title: string | null, time: number) {
  await env.DB.prepare(
    "INSERT INTO media (id,account_id,external_id,caption,title,title_search,search_text,media_type,product_type,permalink,published_at,updated_at) VALUES (?,?,?,?,?,?,?,'VIDEO','REELS',?,?,?)",
  )
    .bind(
      id,
      accountId,
      id,
      caption,
      title,
      normalizeSearch(title ?? ""),
      normalizeSearch(caption),
      `https://www.instagram.com/reel/${id}/`,
      time,
      time,
    )
    .run();
}

it("resolves an old unique exact title across the entire account and keeps duplicate titles ambiguous", async () => {
  const f = fixture();
  await connect(f);
  await seed("old", "", "Ёлка — бар", 1);
  for (let n = 0; n < 25; n++) await seed(`new${n}`, "Елка бар и вечер", null, 100 + n);
  const path = `/api/reports/media?${new URLSearchParams({ query: "ЕЛКА бар", accountId })}`;
  const result = (await (await f.request(path)).json()) as {
    status: string;
    candidates: { id: string }[];
    moreMatches: boolean;
  };
  expect(result.status).toBe("matched");
  expect(result.candidates.map((item) => item.id)).toEqual(["old"]);
  expect(result.moreMatches).toBe(false);
  await seed("duplicate", "", "елка бар", 2);
  const duplicate = (await (await f.request(path)).json()) as {
    status: string;
    candidates: unknown[];
  };
  expect(duplicate.status).toBe("ambiguous");
  expect(duplicate.candidates).toHaveLength(2);
});

it("ranks whole words above substrings and paginates the relevance order without duplicates", async () => {
  const f = fixture();
  await connect(f);
  await seed("partial", "Барби", null, 300);
  await seed("word", "Идём в бар!", null, 200);
  await seed("exact", "", "Бар", 100);
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const response = await f.request(
      `/api/media?${new URLSearchParams({ q: "Бар", limit: "1", ...(cursor ? { cursor } : {}) })}`,
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as { items: { id: string }[]; nextCursor: string | null };
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  expect(ids).toEqual(["exact", "word", "partial"]);
});
