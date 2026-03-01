import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Connection } from "vscode-languageserver";
import {
  ContractClassification,
  ProtocolClassification,
  ProtocolSpecification,
  classifyContractName,
  classifyProtocolName,
} from "./completionSupport";
import { Defaults, normalizeContractClassification, normalizeProtocolClassification } from "./lang/normalization";

type StudioConfig = { hostname: string; port: number; allowInsecure: boolean };
type NetworkPaths = { rootPrefix: string; specPrefix: string };

type RemoteRequirement = {
  name?: string;
  type: string;
  protocol?: string;
  hint?: string;
  length?: number;
  minimum?: number;
  maximum?: number;
};

export type RemoteContractSpec = {
  name: string;
  description?: string;
  requirements?: RemoteRequirement[];
  obligations?: RemoteRequirement[];
  suppliers?: string[];
};

export type RemoteProtocolSpec = ProtocolSpecification & {
  name: string;
  description?: string;
  policy?: number;
};

type RemoteSpec = RemoteContractSpec | RemoteProtocolSpec;
type SpecKind = "contract" | "protocol";

type CacheConfig = {
  softTtlHours: number;
  fetchConcurrency: number;
  retryCount: number;
  retryBaseMs: number;
  allowStale: boolean;
  enableRootDocFallback: boolean;
  requestTimeoutMs: number;
  failureTtlMs: number;
  rootRefreshMinutes: number;
};

type CacheEntry = {
  kind: SpecKind;
  canonical: string;
  spec: RemoteSpec;
  fetchedAt: string;
  expiresAt: string;
  lastSuccessAt: string;
  lastError?: string;
  etag?: string;
};

export type SpecFetchResult<TSpec extends RemoteSpec = RemoteSpec> = {
  spec: TSpec | null;
  canonical?: string;
  stale?: boolean;
  reason?: string;
  fromCache?: boolean;
};

type UnifiedFetchOptions = {
  kind?: SpecKind;
  defaults?: Partial<Defaults> & { supplier?: string };
  allowStale?: boolean;
  preferFresh?: boolean;
};

type PersistedCachePayload = {
  completionCache?: ContractClassification[];
  protocolCompletionCache?: ProtocolClassification[];
  specCache?: Record<string, RemoteSpec | CacheEntry>;
  specAliases?: Record<string, string>;
  rootDocument?: Record<string, string>;
  rootPathPrefix?: string;
  specPathPrefix?: string;
};

class StudioNotModifiedError extends Error {
  readonly status = 304;

  constructor(url: string) {
    super(`Studio 304 Not Modified fetching '${url}'`);
    this.name = "StudioNotModifiedError";
  }
}

class GatewayClient {
  #config: StudioConfig = { hostname: "localhost", port: 10000, allowInsecure: true };
  #apiRoot = "http://localhost:10000";
  #completionCache: ContractClassification[] = [];
  #protocolCompletionCache: ProtocolClassification[] = [];
  #specCache: Record<string, CacheEntry> = {};
  #specAliases: Record<string, string> = {};
  #rootDocument: Record<string, string> = {};
  #cacheTimer: NodeJS.Timeout | undefined;
  #connection: Connection | undefined;
  #cacheFilePath: string;
  #rootPathPrefix = "/fetch/";
  #specPathPrefix = "/fetch/";
  #cacheConfig: CacheConfig = {
    softTtlHours: 24,
    fetchConcurrency: 6,
    retryCount: 2,
    retryBaseMs: 250,
    allowStale: true,
    enableRootDocFallback: false,
    requestTimeoutMs: 10000,
    failureTtlMs: 15000,
    rootRefreshMinutes: 30,
  };
  #inflightFetches = new Map<string, Promise<SpecFetchResult<RemoteSpec>>>();
  #activeFetches = 0;
  #fetchQueue: Array<() => void> = [];
  #failedFetchCooldown = new Map<string, { until: number; reason: string }>();

  constructor() {
    this.#cacheFilePath = path.join(os.homedir(), ".emergent", "contractCache.json");
    this.loadDiskCache();
  }

  attachConnection(conn: Connection) {
    this.#connection = conn;
  }

  setConfig(cfg: StudioConfig) {
    this.#config = cfg;
    this.#apiRoot = `${cfg.allowInsecure ? "http" : "https"}://${cfg.hostname}:${cfg.port}`;
  }

  setCacheConfig(config: Partial<CacheConfig>) {
    const previousRefreshMinutes = this.#cacheConfig.rootRefreshMinutes;
    const previousRootDocFallback = this.#cacheConfig.enableRootDocFallback;
    this.#cacheConfig = {
      ...this.#cacheConfig,
      ...config,
      softTtlHours: Math.max(1, Number(config.softTtlHours ?? this.#cacheConfig.softTtlHours) || this.#cacheConfig.softTtlHours),
      fetchConcurrency: Math.max(1, Number(config.fetchConcurrency ?? this.#cacheConfig.fetchConcurrency) || this.#cacheConfig.fetchConcurrency),
      retryCount: Math.max(0, Number(config.retryCount ?? this.#cacheConfig.retryCount) || this.#cacheConfig.retryCount),
      retryBaseMs: Math.max(50, Number(config.retryBaseMs ?? this.#cacheConfig.retryBaseMs) || this.#cacheConfig.retryBaseMs),
      allowStale: typeof config.allowStale === "boolean" ? config.allowStale : this.#cacheConfig.allowStale,
      enableRootDocFallback:
        typeof config.enableRootDocFallback === "boolean"
          ? config.enableRootDocFallback
          : this.#cacheConfig.enableRootDocFallback,
      requestTimeoutMs:
        Math.max(100, Number(config.requestTimeoutMs ?? this.#cacheConfig.requestTimeoutMs) || this.#cacheConfig.requestTimeoutMs),
      failureTtlMs:
        Math.max(0, Number(config.failureTtlMs ?? this.#cacheConfig.failureTtlMs) || this.#cacheConfig.failureTtlMs),
      rootRefreshMinutes:
        Math.max(1, Number(config.rootRefreshMinutes ?? this.#cacheConfig.rootRefreshMinutes) || this.#cacheConfig.rootRefreshMinutes),
    };
    if (
      this.#cacheTimer &&
      (previousRefreshMinutes !== this.#cacheConfig.rootRefreshMinutes ||
        previousRootDocFallback !== this.#cacheConfig.enableRootDocFallback)
    ) {
      this.startCacheTimer();
    }
  }

  setNetworkPaths(networkLabel: string) {
    const normalized = networkLabel?.toString() ?? "";
    const paths: NetworkPaths =
      NETWORK_PATHS[normalized] ?? NETWORK_PATHS["31"]; // default to 31 network paths
    this.#rootPathPrefix = paths.rootPrefix;
    this.#specPathPrefix = paths.specPrefix;
    this.#connection?.console.log(
      `Studio network "${normalized || "default"}" using root prefix "${this.#rootPathPrefix}" and spec prefix "${this.#specPathPrefix}"`
    );
  }

  dispose() {
    this.stopCacheTimer();
  }

  get completionCache(): ContractClassification[] {
    return this.#completionCache;
  }
  get protocolCache(): ProtocolClassification[] {
    return this.#protocolCompletionCache;
  }
  get cacheFilePath(): string {
    return this.#cacheFilePath;
  }

  private inferKind(classification: string): SpecKind {
    const parts = classification.split("/").filter(Boolean);
    if (parts.length <= 4) return "protocol";
    return "contract";
  }

  private canonicalizeClassification(
    rawClassification: string,
    kind: SpecKind,
    defaults?: Partial<Defaults> & { supplier?: string }
  ): string {
    const normalized =
      kind === "protocol"
        ? normalizeProtocolClassification(rawClassification, defaults as any)
        : normalizeContractClassification(rawClassification, defaults as any);
    return normalized || rawClassification;
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private computeExpiryIso(fromIso: string): string {
    const base = new Date(fromIso).getTime();
    const ttlMs = this.#cacheConfig.softTtlHours * 60 * 60 * 1000;
    return new Date(base + ttlMs).toISOString();
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() >= new Date(entry.expiresAt).getTime();
  }

  private upsertCacheEntry(canonical: string, kind: SpecKind, spec: RemoteSpec) {
    const now = this.nowIso();
    this.#specCache[canonical] = {
      kind,
      canonical,
      spec,
      fetchedAt: now,
      expiresAt: this.computeExpiryIso(now),
      lastSuccessAt: now,
    };
  }

  async refreshContractCache(): Promise<void> {
    if (!this.#cacheConfig.enableRootDocFallback) {
      return;
    }
    const rootPrefixWithTrailingSlash = this.#rootPathPrefix.endsWith("/")
      ? this.#rootPathPrefix
      : `${this.#rootPathPrefix}/`;
    // Root document requires a trailing slash. For legacy networks this results in a double slash which Studio expects.
    const rootUrl = `${this.#apiRoot}${rootPrefixWithTrailingSlash}/`;
    try {
      const rootDoc = await this.fetchJson(rootUrl);
      this.#rootDocument = typeof rootDoc === "object" && rootDoc !== null ? rootDoc : {};
      const contractRoots: ContractClassification[] = [];
      const protocolRoots: ProtocolClassification[] = [];
      for (const spec in this.#rootDocument) {
        const contract = classifyContractName(spec);
        if (contract) {
          contractRoots.push(contract);
          continue;
        }
        const protocol = classifyProtocolName(spec);
        if (protocol) {
          protocolRoots.push(protocol);
        }
      }
      this.#completionCache = contractRoots;
      this.#protocolCompletionCache = protocolRoots;
      this.#connection?.console.log(
        `Updated contract cache with ${this.#completionCache.length} contracts and ${this.#protocolCompletionCache.length} protocols.`
      );
      this.persistDiskCache();
    } catch (err: any) {
      if (this.isNotModifiedError(err)) {
        this.#connection?.console.log("Studio root returned 304 Not Modified; keeping existing contract/protocol cache.");
        return;
      }
      this.#connection?.console.error(`Failed to refresh contract cache: ${err.message}`);
    }
  }

  startCacheTimer() {
    this.stopCacheTimer();
    if (!this.#cacheConfig.enableRootDocFallback) {
      return;
    }
    const cacheIntervalMs = this.#cacheConfig.rootRefreshMinutes * 60 * 1000;
    this.#cacheTimer = setInterval(() => {
      void this.refreshContractCache();
    }, cacheIntervalMs);
  }

  stopCacheTimer() {
    if (this.#cacheTimer) {
      clearInterval(this.#cacheTimer);
      this.#cacheTimer = undefined;
    }
  }

  async fetchSpecResult(
    classification: string,
    options?: UnifiedFetchOptions
  ): Promise<SpecFetchResult<RemoteSpec>> {
    const kind = options?.kind ?? this.inferKind(classification);
    const canonical = this.canonicalizeClassification(classification, kind, options?.defaults);
    this.#specAliases[classification] = canonical;
    const allowStale = options?.allowStale ?? this.#cacheConfig.allowStale;
    const preferFresh = options?.preferFresh ?? false;
    const cached = this.#specCache[canonical];

    if (cached && !this.isExpired(cached)) {
      return { spec: cached.spec, canonical, fromCache: true, stale: false };
    }

    if (cached && allowStale && !preferFresh) {
      void this.refreshSpecInBackground(canonical, cached.kind || kind);
      return {
        spec: cached.spec,
        canonical,
        fromCache: true,
        stale: true,
        reason: "Serving stale cached specification while refreshing in background.",
      };
    }

    const throttledFailure = this.getActiveFailureCooldown(canonical);
    if (throttledFailure && !preferFresh) {
      return {
        spec: cached?.spec ?? null,
        canonical,
        fromCache: !!cached,
        stale: !!cached,
        reason: throttledFailure.reason,
      };
    }

    return this.fetchAndUpdateSpec(canonical, cached?.kind || kind, cached);
  }

  async fetchContractSpecResult(classification: string): Promise<SpecFetchResult<RemoteContractSpec>> {
    const result = await this.fetchSpecResult(classification, { kind: "contract" });
    return {
      ...result,
      spec: (result.spec as RemoteContractSpec | null) ?? null,
    };
  }

  async fetchContractSpec(classification: string): Promise<RemoteContractSpec | null> {
    const result = await this.fetchSpecResult(classification, { kind: "contract" });
    return (result.spec as RemoteContractSpec | null) ?? null;
  }

  async fetchProtocolSpec(classification: string): Promise<RemoteProtocolSpec | null> {
    const result = await this.fetchSpecResult(classification, { kind: "protocol" });
    return (result.spec as RemoteProtocolSpec | null) ?? null;
  }

  private async refreshSpecInBackground(canonical: string, kind: SpecKind): Promise<void> {
    if (this.#inflightFetches.has(canonical)) {
      return;
    }
    try {
      await this.fetchAndUpdateSpec(canonical, kind, this.#specCache[canonical]);
    } catch {
      // Best-effort refresh only.
    }
  }

  private async fetchAndUpdateSpec(
    canonical: string,
    kind: SpecKind,
    cached?: CacheEntry
  ): Promise<SpecFetchResult<RemoteSpec>> {
    const existingInflight = this.#inflightFetches.get(canonical);
    if (existingInflight) {
      const joined = await existingInflight;
      return { ...joined, canonical: joined.canonical ?? canonical };
    }

    const task = this.withFetchLimit(async () => {
      const fetched = await this.fetchSpecFromNetwork(canonical, kind, cached);
      if (fetched.spec) {
        this.#failedFetchCooldown.delete(canonical);
        this.upsertCacheEntry(canonical, kind, fetched.spec);
        this.persistDiskCache();
        return {
          spec: fetched.spec,
          canonical,
          fromCache: false,
          stale: false,
          reason: fetched.reason,
        } as SpecFetchResult<RemoteSpec>;
      }

      if (cached) {
        this.recordFailureCooldown(canonical, fetched.reason ?? "Fetch failed; serving cached specification.");
        const now = this.nowIso();
        this.#specCache[canonical] = {
          ...cached,
          lastError: fetched.reason ?? cached.lastError,
          // Do not invalidate existing payload on failure.
          expiresAt: cached.expiresAt || this.computeExpiryIso(now),
        };
        this.persistDiskCache();
        return {
          spec: cached.spec,
          canonical,
          fromCache: true,
          stale: true,
          reason: fetched.reason ?? "Fetch failed; serving cached specification.",
        } as SpecFetchResult<RemoteSpec>;
      }

      this.recordFailureCooldown(canonical, fetched.reason ?? "Specification fetch failed.");
      return {
        spec: null,
        canonical,
        reason: fetched.reason ?? "Specification fetch failed.",
        fromCache: false,
      } as SpecFetchResult<RemoteSpec>;
    });

    this.#inflightFetches.set(canonical, task);
    try {
      return await task;
    } finally {
      this.#inflightFetches.delete(canonical);
    }
  }

  private async fetchSpecFromNetwork(
    classification: string,
    kind: SpecKind,
    cached?: CacheEntry
  ): Promise<{ spec: RemoteSpec | null; reason?: string }> {
    const gatewayUrl = `${this.#apiRoot}${this.#specPathPrefix}${classification}`;
    try {
      const spec = (await this.fetchJsonWithRetry(gatewayUrl)) as RemoteSpec;
      return { spec };
    } catch (err: any) {
      if (this.isNotModifiedError(err) && cached?.spec) {
        return { spec: cached.spec, reason: "Studio returned 304 Not Modified; using cached specification." };
      }
      this.#connection?.console.warn(`Studio fetch failed for ${classification}: ${err.message}`);
      if (!this.#cacheConfig.enableRootDocFallback) {
        return { spec: null, reason: err?.message ?? String(err) };
      }
    }

    const host = await this.ensureHostForClassification(classification);
    const hostUrl = host
      ? `${this.#config.allowInsecure ? "http" : "https"}://${host}${this.#specPathPrefix}${classification}`
      : null;
    if (!hostUrl) {
      this.#connection?.console.error(`No host available for ${kind} ${classification}`);
      return { spec: null, reason: "No host mapping found in root document for this classification." };
    }

    try {
      const spec = (await this.fetchJsonWithRetry(hostUrl)) as RemoteSpec;
      return { spec };
    } catch (err: any) {
      if (this.isNotModifiedError(err) && cached?.spec) {
        return { spec: cached.spec, reason: "Host returned 304 Not Modified; using cached specification." };
      }
      this.#connection?.console.error(`Failed to fetch ${kind} spec ${classification} from host ${host}: ${err.message}`);
      return { spec: null, reason: err?.message ?? String(err) };
    }
  }

  clearCache(): void {
    this.#completionCache = [];
    this.#protocolCompletionCache = [];
    this.#specCache = {};
    this.#specAliases = {};
    this.#rootDocument = {};
    this.#failedFetchCooldown.clear();
    this.#inflightFetches.clear();
    try {
      if (fs.existsSync(this.#cacheFilePath)) {
        fs.unlinkSync(this.#cacheFilePath);
      }
    } catch (err: any) {
      this.#connection?.console.error(`Failed to clear cache file ${this.#cacheFilePath}: ${err.message}`);
    }
  }


  private async withFetchLimit<T>(work: () => Promise<T>): Promise<T> {
    if (this.#activeFetches >= this.#cacheConfig.fetchConcurrency) {
      await new Promise<void>((resolve) => {
        this.#fetchQueue.push(resolve);
      });
    }
    this.#activeFetches += 1;
    try {
      return await work();
    } finally {
      this.#activeFetches = Math.max(0, this.#activeFetches - 1);
      const next = this.#fetchQueue.shift();
      if (next) next();
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchJsonWithRetry(url: string): Promise<any> {
    const maxAttempts = this.#cacheConfig.retryCount + 1;
    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.fetchJson(url);
      } catch (err: any) {
        lastError = err;
        if (this.isNotModifiedError(err)) {
          throw err;
        }
        if (attempt >= maxAttempts) {
          break;
        }
        const jitter = Math.floor(Math.random() * this.#cacheConfig.retryBaseMs);
        const delay = this.#cacheConfig.retryBaseMs * Math.pow(2, attempt - 1) + jitter;
        await this.sleep(delay);
      }
    }
    throw lastError;
  }

  private async fetchJson(url: string): Promise<any> {
    let timeoutHandle: NodeJS.Timeout | undefined;
    try {
      const controller = new AbortController();
      timeoutHandle = setTimeout(() => {
        controller.abort();
      }, this.#cacheConfig.requestTimeoutMs);
      const res = await (globalThis as any).fetch(url, {
        headers: {
          "cache-control": "no-cache",
          pragma: "no-cache",
        },
        signal: controller.signal,
      });
      if (res.status === 304) {
        throw new StudioNotModifiedError(url);
      }
      if (!res.ok) {
        throw new Error(`Studio ${res.status} ${res.statusText} fetching ${url}`);
      }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON received from ${url}`);
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error(`Connection timed out fetching ${url}`);
      }
      switch (error?.code) {
        case "ECONNRESET":
        case "ETIMEDOUT":
          throw new Error(`Connection timed out fetching ${url}`);
        case "ENOTFOUND":
          throw new Error(`Host not found fetching ${url}`);
        default:
          throw new Error(error?.message ? error.message : `Failed to fetch ${url}`);
      }
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private isNotModifiedError(error: unknown): error is StudioNotModifiedError {
    return error instanceof StudioNotModifiedError;
  }

  private async ensureHostForClassification(classification: string): Promise<string | undefined> {
    if (!this.#cacheConfig.enableRootDocFallback) {
      return undefined;
    }
    if (this.#rootDocument[classification]) {
      return this.#rootDocument[classification];
    }
    await this.refreshContractCache();
    return this.#rootDocument[classification];
  }

  private loadDiskCache() {
    try {
      if (!fs.existsSync(this.#cacheFilePath)) {
        return;
      }
      const raw = fs.readFileSync(this.#cacheFilePath, "utf8");
      const data = JSON.parse(raw) as PersistedCachePayload;
      this.#completionCache = Array.isArray(data?.completionCache) ? data.completionCache : [];
      this.#protocolCompletionCache = Array.isArray(data?.protocolCompletionCache) ? data.protocolCompletionCache : [];
      const parsedSpecCache = typeof data?.specCache === "object" && data.specCache !== null ? data.specCache : {};
      const migrated: Record<string, CacheEntry> = {};
      const now = this.nowIso();
      for (const [key, value] of Object.entries(parsedSpecCache)) {
        if (!value || typeof value !== "object") continue;
        const maybeEntry = value as CacheEntry;
        if ("spec" in maybeEntry && "canonical" in maybeEntry && "expiresAt" in maybeEntry) {
          migrated[key] = maybeEntry;
          continue;
        }
        const inferredKind = this.inferKind(key);
        migrated[key] = {
          kind: inferredKind,
          canonical: key,
          spec: value as RemoteSpec,
          fetchedAt: now,
          lastSuccessAt: now,
          expiresAt: this.computeExpiryIso(now),
        };
      }
      this.#specCache = migrated;
      this.#specAliases = typeof data?.specAliases === "object" && data.specAliases !== null ? data.specAliases : {};
      this.#rootDocument = typeof data?.rootDocument === "object" && data.rootDocument !== null ? data.rootDocument : {};
      if (typeof data?.rootPathPrefix === "string") this.#rootPathPrefix = data.rootPathPrefix;
      if (typeof data?.specPathPrefix === "string") this.#specPathPrefix = data.specPathPrefix;
    } catch (err: any) {
      this.#connection?.console.error(`Failed to load disk cache: ${err.message}`);
    }
  }

  private persistDiskCache() {
    try {
      fs.mkdirSync(path.dirname(this.#cacheFilePath), { recursive: true });
      const payload = {
        completionCache: this.#completionCache,
        protocolCompletionCache: this.#protocolCompletionCache,
        specCache: this.#specCache,
        specAliases: this.#specAliases,
        rootDocument: this.#rootDocument,
        rootPathPrefix: this.#rootPathPrefix,
        specPathPrefix: this.#specPathPrefix,
      };
      fs.writeFileSync(this.#cacheFilePath, JSON.stringify(payload, null, 2), "utf8");
    } catch (err: any) {
      this.#connection?.console.error(`Failed to persist disk cache: ${err.message}`);
    }
  }

  private getActiveFailureCooldown(canonical: string): { until: number; reason: string } | null {
    const current = this.#failedFetchCooldown.get(canonical);
    if (!current) {
      return null;
    }
    if (Date.now() >= current.until) {
      this.#failedFetchCooldown.delete(canonical);
      return null;
    }
    return current;
  }

  private recordFailureCooldown(canonical: string, reason: string) {
    if (this.#cacheConfig.failureTtlMs <= 0) {
      return;
    }
    this.#failedFetchCooldown.set(canonical, {
      reason,
      until: Date.now() + this.#cacheConfig.failureTtlMs,
    });
  }
}

const NETWORK_PATHS: Record<string, NetworkPaths> = {
  // Legacy network (double trailing slash on root fetch).
  "31": { rootPrefix: "/fetch/", specPrefix: "/fetch/" },
  // Newer network paths.
  "34": { rootPrefix: "/api/valley/fetch/", specPrefix: "/api/valley/fetch/" },
};

export const gatewayClient = new GatewayClient();
