import fetch from "node-fetch";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Connection } from "vscode-languageserver";
import { ContractClassification, classifyContractName } from "./completionSupport";

type GatewayConfig = { hostname: string; port: number; allowInsecure: boolean };

export type RemoteContractSpec = {
  name: string;
  description?: string;
  requirements?: Array<{ name: string; type: string; protocol?: string; hint?: string; length?: number; minimum?: number; maximum?: number }>;
  obligations?: Array<{ name: string; type: string; protocol?: string; hint?: string; length?: number; minimum?: number; maximum?: number }>;
  suppliers?: string[];
};

class GatewayClient {
  #config: GatewayConfig = { hostname: "localhost", port: 10000, allowInsecure: true };
  #apiRoot = "http://localhost:10000";
  #completionCache: ContractClassification[] = [];
  #specCache: Record<string, RemoteContractSpec> = {};
  #rootDocument: Record<string, string> = {};
  #cacheTimer: NodeJS.Timer | undefined;
  #connection: Connection | undefined;
  #cacheIntervalMs = 30 * 60 * 1000;
  #cacheFilePath: string;

  constructor() {
    this.#cacheFilePath = path.join(os.homedir(), ".emergent", "contractCache.json");
    this.loadDiskCache();
  }

  attachConnection(conn: Connection) {
    this.#connection = conn;
  }

  setConfig(cfg: GatewayConfig) {
    this.#config = cfg;
    this.#apiRoot = `${cfg.allowInsecure ? "http" : "https"}://${cfg.hostname}:${cfg.port}`;
  }

  dispose() {
    this.stopCacheTimer();
  }

  get completionCache(): ContractClassification[] {
    return this.#completionCache;
  }

  async refreshContractCache(): Promise<void> {
    // Root document requires a double trailing slash to differentiate from spec fetch.
    const rootUrl = `${this.#apiRoot}/fetch//`;
    try {
      const rootDoc = await this.fetchJson(rootUrl);
      this.#rootDocument = typeof rootDoc === "object" && rootDoc !== null ? rootDoc : {};
      const roots: ContractClassification[] = [];
      for (const spec in this.#rootDocument) {
        const c = classifyContractName(spec);
        if (c) roots.push(c);
      }
      this.#completionCache = roots;
      this.#connection?.console.log(`Updated contract cache with ${this.#completionCache.length} entries.`);
      this.persistDiskCache();
    } catch (err: any) {
      this.#connection?.console.error(`Failed to refresh contract cache: ${err.message}`);
    }
  }

  startCacheTimer() {
    this.stopCacheTimer();
    this.#cacheTimer = setInterval(() => {
      void this.refreshContractCache();
    }, this.#cacheIntervalMs);
  }

  stopCacheTimer() {
    if (this.#cacheTimer) {
      clearInterval(this.#cacheTimer);
      this.#cacheTimer = undefined;
    }
  }

  async fetchContractSpec(classification: string): Promise<RemoteContractSpec | null> {
    const host = await this.ensureHostForClassification(classification);
    const url = host
      ? `${this.#config.allowInsecure ? "http" : "https"}://${host}/fetch${classification.startsWith("/") ? "" : "/"}${classification}`
      : null;
    const cached = this.#specCache[classification];
    if (!url) {
      this.#connection?.console.error(`No host available for contract ${classification}`);
      return cached ?? null;
    }
    try {
      const spec = await this.fetchJson(url);
      this.#specCache[classification] = spec;
      this.persistDiskCache();
      return spec;
    } catch (err: any) {
      this.#connection?.console.error(`Failed to fetch contract spec ${classification}: ${err.message}`);
      if (cached) {
        this.#connection?.console.log(`Serving cached contract spec for ${classification}`);
        return cached;
      }
      return null;
    }
  }

  private async fetchJson(url: string): Promise<any> {
    try {
      const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
      if (!res.ok) {
        throw new Error(`Gateway ${res.status} ${res.statusText} fetching ${url}`);
      }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON received from ${url}`);
      }
    } catch (error: any) {
      switch (error?.code) {
        case "ECONNRESET":
        case "ETIMEDOUT":
          throw new Error(`Connection timed out fetching ${url}`);
        case "ENOTFOUND":
          throw new Error(`Host not found fetching ${url}`);
        default:
          throw new Error(error?.message ? error.message : `Failed to fetch ${url}`);
      }
    }
  }

  private async ensureHostForClassification(classification: string): Promise<string | undefined> {
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
      const data = JSON.parse(raw);
      this.#completionCache = Array.isArray(data?.completionCache) ? data.completionCache : [];
      this.#specCache = typeof data?.specCache === "object" && data.specCache !== null ? data.specCache : {};
      this.#rootDocument = typeof data?.rootDocument === "object" && data.rootDocument !== null ? data.rootDocument : {};
    } catch (err: any) {
      this.#connection?.console.error(`Failed to load disk cache: ${err.message}`);
    }
  }

  private persistDiskCache() {
    try {
      fs.mkdirSync(path.dirname(this.#cacheFilePath), { recursive: true });
      const payload = {
        completionCache: this.#completionCache,
        specCache: this.#specCache,
        rootDocument: this.#rootDocument,
      };
      fs.writeFileSync(this.#cacheFilePath, JSON.stringify(payload, null, 2), "utf8");
    } catch (err: any) {
      this.#connection?.console.error(`Failed to persist disk cache: ${err.message}`);
    }
  }
}

export const gatewayClient = new GatewayClient();
