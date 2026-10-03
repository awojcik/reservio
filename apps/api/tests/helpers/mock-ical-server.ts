import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local stand-in for a provider's iCal feed. Tests never call a real
 * provider (§58), and this also lets a test decide to fail, hang or return
 * garbage on demand.
 */
export type MockFeed = {
  url: string;
  /** Replaces what the next request receives. */
  setBody: (body: string) => void;
  setStatus: (status: number) => void;
  /** Redirect target for the next request, e.g. to prove a redirect is re-checked. */
  setRedirect: (location: string | null) => void;
  requestCount: () => number;
  close: () => Promise<void>;
};

export async function startMockIcalServer(initialBody: string): Promise<MockFeed> {
  let body = initialBody;
  let status = 200;
  let redirect: string | null = null;
  let requests = 0;

  const server: Server = createServer((request, response) => {
    requests += 1;

    if (redirect) {
      response.writeHead(302, { location: redirect });
      response.end();
      return;
    }

    if (status !== 200) {
      response.writeHead(status);
      response.end("nope");
      return;
    }

    response.writeHead(200, { "content-type": "text/calendar; charset=utf-8" });
    response.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/calendar.ics`,
    setBody: (next) => {
      body = next;
    },
    setStatus: (next) => {
      status = next;
    },
    setRedirect: (next) => {
      redirect = next;
    },
    requestCount: () => requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
