// @effect-diagnostics nodeBuiltinImport:off - The protocol test uses a temporary local asset.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vite-plus/test";

const { handleMock, netFetchMock, unhandleMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  netFetchMock: vi.fn(),
  unhandleMock: vi.fn(),
}));

vi.mock("electron", () => ({
  net: { fetch: netFetchMock },
  protocol: { handle: handleMock, unhandle: unhandleMock },
}));

import * as ElectronProtocol from "./ElectronProtocol.ts";

const NodeFS = NodeFSP;

describe("ElectronProtocol", () => {
  beforeEach(() => {
    handleMock.mockReset();
    netFetchMock.mockReset();
    unhandleMock.mockReset();
  });

  it.effect("proxies the stable renderer origin to the current app server", () =>
    Effect.gen(function* () {
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      netFetchMock.mockResolvedValue(new Response("ok"));

      yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "t3science-dev",
            targetOrigin: new URL("http://127.0.0.1:3773/"),
            backendOrigin: new URL("http://127.0.0.1:3774/"),
            clerkFrontendApiHostname: "clerk.t3.codes",
          });
          assert.isDefined(handler);

          const response = yield* Effect.promise(() =>
            handler!(
              new Request("t3science-dev://app/api/health?verbose=1", {
                headers: {
                  accept: "application/json",
                  origin: "t3science-dev://app",
                  referer: "t3science-dev://app/",
                  "sec-fetch-site": "same-origin",
                },
              }),
            ),
          );
          assert.equal(yield* Effect.promise(() => response.text()), "ok");
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://clerk.t3.codes https://challenges.cloudflare.com",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "connect-src 'self' http: https: ws: wss:",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "img-src 'self' t3science-dev: blob: data: http: https:",
          );
          assert.include(
            response.headers.get("content-security-policy") ?? "",
            "font-src 'self' t3science-dev: data:",
          );
        }),
      );

      assert.deepEqual(
        handleMock.mock.calls.map((call) => call[0]),
        ["t3science-dev"],
      );
      assert.equal(netFetchMock.mock.calls[0]?.[0], "http://127.0.0.1:3773/api/health?verbose=1");
      const forwardedHeaders = new Headers(netFetchMock.mock.calls[0]?.[1]?.headers);
      assert.equal(forwardedHeaders.get("accept"), "application/json");
      assert.isNull(forwardedHeaders.get("origin"));
      assert.isNull(forwardedHeaders.get("referer"));
      assert.isNull(forwardedHeaders.get("sec-fetch-site"));
      assert.deepEqual(unhandleMock.mock.calls, [["t3science-dev"]]);
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );

  it.effect("rejects custom protocol requests for another host", () =>
    Effect.gen(function* () {
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });

      const response = yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "t3science",
            targetOrigin: new URL("http://127.0.0.1:3773/"),
            backendOrigin: new URL("http://127.0.0.1:3773/"),
            clerkFrontendApiHostname: undefined,
          });
          return yield* Effect.promise(() => handler!(new Request("t3science://other/")));
        }),
      );

      assert.equal(response.status, 404);
      assert.equal(netFetchMock.mock.calls.length, 0);
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );

  it.effect("serves desktop pet spritesheets with an immutable revision", () =>
    Effect.gen(function* () {
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      const directory = yield* Effect.promise(() =>
        NodeFS.mkdtemp(NodePath.join(process.env.TEMP ?? process.cwd(), "t3-protocol-test-")),
      );
      const filePath = NodePath.join(directory, "spritesheet.webp");
      yield* Effect.promise(() => NodeFS.writeFile(filePath, "webp"));
      try {
        const response = yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* ElectronProtocol.ElectronProtocol;
            yield* protocol.registerDesktopProtocol({
              scheme: "t3science-dev",
              targetOrigin: new URL("http://127.0.0.1:3773/"),
              backendOrigin: new URL("http://127.0.0.1:3773/"),
              clerkFrontendApiHostname: undefined,
              resolveDesktopPetSpritesheet: async (petId) =>
                petId === "codex-buddy" ? { filePath, assetRevision: "revision-1" } : null,
            });
            return yield* Effect.promise(() =>
              handler!(
                new Request(
                  "t3science-dev://app/__desktop-pets/codex-buddy/spritesheet.webp?v=revision-1",
                ),
              ),
            );
          }),
        );
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "image/webp");
        assert.equal(response.headers.get("etag"), '"revision-1"');
        assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
        assert.equal(yield* Effect.promise(() => response.text()), "webp");

        const cached = yield* Effect.promise(() =>
          handler!(
            new Request(
              "t3science-dev://app/__desktop-pets/codex-buddy/spritesheet.webp?v=revision-1",
              { headers: { "If-None-Match": '"revision-1"' } },
            ),
          ),
        );
        assert.equal(cached.status, 304);

        const head = yield* Effect.promise(() =>
          handler!(
            new Request(
              "t3science-dev://app/__desktop-pets/codex-buddy/spritesheet.webp?v=revision-1",
              { method: "HEAD" },
            ),
          ),
        );
        assert.equal(head.status, 200);
        assert.equal(head.headers.get("content-length"), "4");
        assert.equal(yield* Effect.promise(() => head.text()), "");

        const invalidPath = yield* Effect.promise(() =>
          handler!(
            new Request("t3science-dev://app/__desktop-pets/codex-buddy/../spritesheet.webp"),
          ),
        );
        assert.equal(invalidPath.status, 404);

        const notFound = yield* Effect.scoped(
          Effect.gen(function* () {
            const protocol = yield* ElectronProtocol.ElectronProtocol;
            yield* protocol.registerDesktopProtocol({
              scheme: "t3science-dev",
              targetOrigin: new URL("http://127.0.0.1:3773/"),
              backendOrigin: new URL("http://127.0.0.1:3773/"),
              clerkFrontendApiHostname: undefined,
              resolveDesktopPetSpritesheet: async () => null,
            });
            return yield* Effect.promise(() =>
              handler!(new Request("t3science-dev://app/__desktop-pets/unknown/spritesheet.webp")),
            );
          }),
        );
        assert.equal(notFound.status, 404);
      } finally {
        yield* Effect.promise(() => NodeFS.rm(directory, { recursive: true, force: true }));
      }
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );

  it.effect("retries transient renderer target failures", () =>
    Effect.gen(function* () {
      let handler: ((request: Request) => Promise<Response>) | undefined;
      handleMock.mockImplementation((_scheme, nextHandler) => {
        handler = nextHandler;
      });
      netFetchMock
        .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5733"))
        .mockResolvedValueOnce(new Response("ready"));

      const response = yield* Effect.scoped(
        Effect.gen(function* () {
          const protocol = yield* ElectronProtocol.ElectronProtocol;
          yield* protocol.registerDesktopProtocol({
            scheme: "t3science-dev",
            targetOrigin: new URL("http://127.0.0.1:5733/"),
            backendOrigin: new URL("http://127.0.0.1:3773/"),
            clerkFrontendApiHostname: undefined,
          });
          return yield* Effect.promise(() => handler!(new Request("t3science-dev://app/")));
        }),
      );

      assert.equal(yield* Effect.promise(() => response.text()), "ready");
      assert.equal(netFetchMock.mock.calls.length, 2);
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );

  it.effect("preserves protocol registration failures", () =>
    Effect.gen(function* () {
      const cause = new Error("protocol registration failed");
      handleMock.mockImplementationOnce(() => {
        throw cause;
      });

      const protocol = yield* ElectronProtocol.ElectronProtocol;
      const error = yield* Effect.scoped(
        protocol.registerDesktopProtocol({
          scheme: "t3science-dev",
          targetOrigin: new URL("http://127.0.0.1:3773/"),
          backendOrigin: new URL("http://127.0.0.1:3774/"),
          clerkFrontendApiHostname: undefined,
        }),
      ).pipe(Effect.flip);

      assert.instanceOf(error, ElectronProtocol.ElectronProtocolRegistrationError);
      assert.equal(error.scheme, "t3science-dev");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message, 'Failed to register Electron protocol scheme "t3science-dev".');
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );

  it.effect("preserves protocol unregistration failures", () =>
    Effect.gen(function* () {
      const cause = new Error("protocol unregistration failed");
      unhandleMock.mockImplementationOnce(() => {
        throw cause;
      });

      const protocol = yield* ElectronProtocol.ElectronProtocol;
      const exit = yield* Effect.exit(
        Effect.scoped(
          protocol.registerDesktopProtocol({
            scheme: "t3science",
            targetOrigin: new URL("http://127.0.0.1:3773/"),
            backendOrigin: new URL("http://127.0.0.1:3773/"),
            clerkFrontendApiHostname: undefined,
          }),
        ),
      );

      assert.equal(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const error = Cause.squash(exit.cause);
        assert.instanceOf(error, ElectronProtocol.ElectronProtocolUnregistrationError);
        assert.equal(error.scheme, "t3science");
        assert.strictEqual(error.cause, cause);
        assert.equal(error.message, 'Failed to unregister Electron protocol scheme "t3science".');
      }
    }).pipe(Effect.provide(ElectronProtocol.layer)),
  );

  it("keeps executable sources host-restricted while allowing runtime network resources", () => {
    const policy = ElectronProtocol.makeDesktopContentSecurityPolicy({
      scheme: "t3science",
      targetOrigin: new URL("http://127.0.0.1:3773/"),
      backendOrigin: new URL("http://127.0.0.1:3773/"),
      clerkFrontendApiHostname: "clerk.t3.codes",
    });
    const directives = Object.fromEntries(
      policy.split("; ").map((directive) => {
        const [name, ...sources] = directive.split(" ");
        return [name, sources];
      }),
    );

    assert.deepEqual(directives["script-src"], [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      "https://clerk.t3.codes",
      "https://challenges.cloudflare.com",
    ]);
    assert.deepEqual(directives["connect-src"], ["'self'", "http:", "https:", "ws:", "wss:"]);
    assert.deepEqual(directives["img-src"], [
      "'self'",
      "t3science:",
      "blob:",
      "data:",
      "http:",
      "https:",
    ]);
    assert.deepEqual(directives["font-src"], ["'self'", "t3science:", "data:"]);
  });
});
