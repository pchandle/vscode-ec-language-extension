export type StudioConnectionConfig = {
  hostname: string;
  port: number;
  allowInsecure: boolean;
  network: string;
};

export const DEFAULT_STUDIO_CONNECTION: StudioConnectionConfig = {
  hostname: "localhost",
  port: 10000,
  allowInsecure: true,
  network: "31",
};

type RecordValue = Record<string, unknown>;

function objectValue(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" ? (value as RecordValue) : undefined;
}

export function studioConfigFromInitialization(
  initializationOptions: unknown,
  fallback: StudioConnectionConfig
): StudioConnectionConfig {
  const studio = objectValue(initializationOptions)?.studio;
  const raw = objectValue(studio);
  if (!raw) return fallback;
  return {
    hostname: typeof raw.hostname === "string" && raw.hostname ? raw.hostname : fallback.hostname,
    port: typeof raw.port === "number" && Number.isFinite(raw.port) ? raw.port : fallback.port,
    allowInsecure: typeof raw.allowInsecure === "boolean" ? raw.allowInsecure : fallback.allowInsecure,
    network: typeof raw.network === "string" && raw.network ? raw.network : fallback.network,
  };
}

export function studioConfigUpdateFromSettings(settings: unknown): Partial<StudioConnectionConfig> {
  const raw = objectValue(objectValue(settings)?.studio);
  if (!raw) return {};
  return {
    ...(typeof raw.hostname === "string" && raw.hostname ? { hostname: raw.hostname } : {}),
    ...(typeof raw.port === "number" && Number.isFinite(raw.port) ? { port: raw.port } : {}),
    ...(typeof raw.allowInsecure === "boolean" ? { allowInsecure: raw.allowInsecure } : {}),
    ...(typeof raw.network === "string" && raw.network ? { network: raw.network } : {}),
  };
}
