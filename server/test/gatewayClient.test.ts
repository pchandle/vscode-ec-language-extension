import { strict as assert } from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

type FetchResponse = {
  status: number;
  ok: boolean;
  statusText: string;
  text: () => Promise<string>;
};

type FetchFn = (url: string) => Promise<FetchResponse>;

type LoadedClient = {
  clearCache: () => void;
  setConfig: (cfg: { hostname: string; port: number; allowInsecure: boolean }) => void;
  setCacheConfig: (cfg: Record<string, unknown>) => void;
  fetchSpecResult: (classification: string, options?: Record<string, unknown>) => Promise<any>;
  cacheFilePath: string;
};

function makeJsonResponse(body: unknown, status = 200): FetchResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 200 ? "OK" : String(status),
    text: async () => JSON.stringify(body),
  };
}

function cachePathFor(homeDir: string): string {
  return path.join(homeDir, ".emergent", "contractCache.json");
}

function writeCache(homeDir: string, payload: unknown): void {
  const cachePath = cachePathFor(homeDir);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), "utf8");
}

function readCache(homeDir: string): any {
  const cachePath = cachePathFor(homeDir);
  return JSON.parse(fs.readFileSync(cachePath, "utf8"));
}

function loadGatewayClient(homeDir: string, fetchImpl: FetchFn): LoadedClient {
  (globalThis as any).fetch = fetchImpl;
  const moduleShim = require("module") as any;
  const originalLoad = moduleShim._load;
  const actualOs = require("os");

  moduleShim._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "os") {
      return {
        ...actualOs,
        homedir: () => homeDir,
      };
    }
    return originalLoad.apply(this, arguments as any);
  };

  try {
    const gatewayPath = require.resolve("../src/gatewayClient");
    delete require.cache[gatewayPath];
    const loaded = require(gatewayPath) as { gatewayClient: LoadedClient };
    loaded.gatewayClient.setConfig({ hostname: "localhost", port: 10000, allowInsecure: true });
    return loaded.gatewayClient;
  } finally {
    moduleShim._load = originalLoad;
  }
}

describe("gatewayClient unified spec cache", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync("/tmp/ec-gateway-cache-");
  });

  afterEach(() => {
    if (tmpHome) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("migrates legacy specCache shape and serves migrated entries from cache", async () => {
    const classification = "/data/new/integer/default/x64";
    const legacySpec = { name: classification, requirements: [], obligations: [{ type: "integer" }] };
    writeCache(tmpHome, { specCache: { [classification]: legacySpec } });

    let fetchCalls = 0;
    const gatewayClient = loadGatewayClient(tmpHome, async () => {
      fetchCalls += 1;
      return makeJsonResponse({});
    });

    const result = await gatewayClient.fetchSpecResult(classification, { kind: "contract" });
    assert.equal(fetchCalls, 0, "expected migrated cache hit without network call");
    assert.equal(result.fromCache, true);
    assert.equal(result.stale, false);
    assert.deepEqual(result.spec, legacySpec);
  });

  it("serves stale cached spec immediately and refreshes in background", async () => {
    const classification = "/data/new/integer/default/x64";
    const oldSpec = { name: classification, requirements: [{ type: "integer" }], obligations: [] };
    const newSpec = { name: classification, requirements: [{ type: "string" }], obligations: [] };
    writeCache(tmpHome, {
      specCache: {
        [classification]: {
          kind: "contract",
          canonical: classification,
          spec: oldSpec,
          fetchedAt: "2020-01-01T00:00:00.000Z",
          lastSuccessAt: "2020-01-01T00:00:00.000Z",
          expiresAt: "2020-01-02T00:00:00.000Z",
        },
      },
    });

    let fetchCalls = 0;
    const gatewayClient = loadGatewayClient(tmpHome, async () => {
      fetchCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return makeJsonResponse(newSpec);
    });

    const staleResult = await gatewayClient.fetchSpecResult(classification, { kind: "contract", allowStale: true });
    assert.equal(staleResult.fromCache, true);
    assert.equal(staleResult.stale, true);
    assert.deepEqual(staleResult.spec, oldSpec);

    await new Promise((resolve) => setTimeout(resolve, 30));

    const freshResult = await gatewayClient.fetchSpecResult(classification, { kind: "contract", preferFresh: true });
    assert.equal(fetchCalls >= 1, true, "expected background refresh network call");
    assert.equal(freshResult.fromCache, true);
    assert.equal(freshResult.stale, false);
    assert.deepEqual(freshResult.spec, newSpec);
  });

  it("keeps stale payload when refresh fails", async () => {
    const classification = "/data/new/integer/default/x64";
    const oldSpec = { name: classification, requirements: [{ type: "integer" }], obligations: [] };
    writeCache(tmpHome, {
      specCache: {
        [classification]: {
          kind: "contract",
          canonical: classification,
          spec: oldSpec,
          fetchedAt: "2020-01-01T00:00:00.000Z",
          lastSuccessAt: "2020-01-01T00:00:00.000Z",
          expiresAt: "2020-01-02T00:00:00.000Z",
        },
      },
    });

    const gatewayClient = loadGatewayClient(tmpHome, async () => {
      throw new Error("simulated fetch failure");
    });
    gatewayClient.setCacheConfig({ retryCount: 0 });

    const result = await gatewayClient.fetchSpecResult(classification, { kind: "contract", allowStale: false });
    assert.equal(result.fromCache, true);
    assert.equal(result.stale, true);
    assert.deepEqual(result.spec, oldSpec);

    const persisted = readCache(tmpHome);
    assert.deepEqual(persisted.specCache[classification].spec, oldSpec, "expected cached spec to remain unchanged");
    assert.ok(String(persisted.specCache[classification].lastError || "").length > 0, "expected lastError to be recorded");
  });

  it("deduplicates concurrent inflight fetches per canonical classification", async () => {
    const classification = "/data/new/integer/default/x64";
    const fetchedSpec = { name: classification, requirements: [], obligations: [{ type: "integer" }] };

    let fetchCalls = 0;
    const gatewayClient = loadGatewayClient(tmpHome, async () => {
      fetchCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return makeJsonResponse(fetchedSpec);
    });

    const [a, b] = await Promise.all([
      gatewayClient.fetchSpecResult(classification, { kind: "contract" }),
      gatewayClient.fetchSpecResult(classification, { kind: "contract" }),
    ]);

    assert.equal(fetchCalls, 1, "expected one network fetch for concurrent identical requests");
    assert.deepEqual(a.spec, fetchedSpec);
    assert.deepEqual(b.spec, fetchedSpec);
  });

  it("stores alias mapping from shorthand classification to canonical classification", async () => {
    const raw = "new/integer/subordinate";
    const canonical = "/system/new/integer/subordinate/x64";
    const fetchedSpec = { name: canonical, requirements: [], obligations: [{ type: "integer" }] };

    const gatewayClient = loadGatewayClient(tmpHome, async () => makeJsonResponse(fetchedSpec));

    const result = await gatewayClient.fetchSpecResult(raw, {
      kind: "contract",
      defaults: { layer: "system", variation: "default", platform: "x64" },
    });

    assert.equal(result.canonical, canonical);
    const persisted = readCache(tmpHome);
    assert.equal(persisted.specAliases[raw], canonical);
    assert.deepEqual(persisted.specCache[canonical].spec, fetchedSpec);
  });
});
