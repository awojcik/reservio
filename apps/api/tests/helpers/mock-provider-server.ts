import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type RecordedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export type MockProvider = {
  origin: string;
  host: string;
  /** Answers for one method+path prefix. */
  on: (method: string, pathPrefix: string, handler: () => { status: number; body: unknown }) => void;
  requests: RecordedRequest[];
  /** Clears routes and recorded traffic, so one test cannot answer another's. */
  reset: () => void;
  close: () => Promise<void>;
};

/**
 * A local stand-in for a provider's HTTP API.
 *
 * Contract tests point the real adapter at this and assert on what it actually
 * sent: the path, the method, the auth header, the body shape. That is the
 * only part of the integration a fake service object cannot cover, and the
 * only part that would break silently if a documented path were mistyped
 * (milestone 12 §32).
 */
export async function startMockProvider(): Promise<MockProvider> {
  const routes: { method: string; prefix: string; handler: () => { status: number; body: unknown } }[] =
    [];
  const requests: RecordedRequest[] = [];

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const path = request.url ?? "";
      requests.push({
        method: request.method ?? "GET",
        path,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });

      // Longest prefix wins, so a route for one reservation beats the list.
      const route = routes
        .filter(
          (candidate) =>
            candidate.method === request.method && path.startsWith(candidate.prefix),
        )
        .sort((a, b) => b.prefix.length - a.prefix.length)[0];

      if (!route) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "not found" }));
        return;
      }

      const result = route.handler();
      response.writeHead(result.status, { "content-type": "application/json" });
      response.end(JSON.stringify(result.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    host: "127.0.0.1",
    on: (method, prefix, handler) => routes.push({ method, prefix, handler }),
    requests,
    reset: () => {
      routes.length = 0;
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
