import { collectionCases } from "../../backend/test/collection-phase1-fixtures";
import { exerciseScenario, scenarioRunner } from "../../backend/test/collection-phase1-runner";

let runner: Awaited<ReturnType<typeof scenarioRunner>>;
let counts = { d1BindingCalls: 0, sqlStatements: 0 };

function countedDatabase(database: D1Database): D1Database {
  const statement = (inner: D1PreparedStatement) => ({
    inner,
    bind(...values: unknown[]) { return statement(inner.bind(...values)); },
    all<T>() { counts.d1BindingCalls++; counts.sqlStatements++; return inner.all<T>(); },
    first<T>(column?: string) { counts.d1BindingCalls++; counts.sqlStatements++; return inner.first<T>(column); },
    raw<T>() { counts.d1BindingCalls++; counts.sqlStatements++; return inner.raw<T>(); },
    run<T>() { counts.d1BindingCalls++; counts.sqlStatements++; return inner.run<T>(); },
  });
  return {
    prepare(sql: string) { return statement(database.prepare(sql)); },
    batch(statements: ReturnType<typeof statement>[]) {
      counts.d1BindingCalls++;
      counts.sqlStatements += statements.length;
      return database.batch(statements.map((s) => s.inner));
    },
  } as unknown as D1Database;
}

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const url = new URL(request.url);
    if (url.pathname === "/seed") {
      const scenario = collectionCases.find((s) => s.name === url.searchParams.get("case"));
      if (!scenario) throw new Error("Unknown synthetic case");
      await env.DB.prepare("DELETE FROM accounts").run();
      runner = await scenarioRunner(countedDatabase(env.DB), scenario);
      return Response.json({ seeded: scenario.name });
    }
    if (url.pathname === "/run") {
      counts = { d1BindingCalls: 0, sqlStatements: 0 };
      const result = await exerciseScenario(runner);
      return Response.json({ ...result, ...counts });
    }
    if (url.pathname === "/validate") {
      return Response.json({
        snapshots: await env.DB.prepare("SELECT COUNT(*) AS n FROM media_snapshots").first("n"),
        profileSnapshots: await env.DB.prepare("SELECT COUNT(*) AS n FROM account_snapshots").first("n"),
        receipts: await env.DB.prepare("SELECT COUNT(*) AS n FROM instagram_http_attempts").first("n"),
      });
    }
    return new Response("Synthetic fixture endpoint only", { status: 404 });
  },
};
