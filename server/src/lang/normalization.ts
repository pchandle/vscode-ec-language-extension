export type Defaults = { layer: string; variation: string; platform: string };

const EMPTY_DEFAULTS: Defaults = { layer: "", variation: "", platform: "" };

const ApplyDefault = (seg: string | undefined, fallback: string) => (!seg || seg === "." ? fallback : seg);

export function normalizeContractClassification(raw: string, defaults?: Defaults): string | null {
  return normalizeInternal(raw, defaults, false);
}

export function normalizeProtocolClassification(raw: string, defaults?: Defaults): string | null {
  return normalizeInternal(raw, defaults, true);
}

function normalizeInternal(raw: string, defaults?: Defaults, isProtocol = false): string | null {
  if (!raw) return null;
  const defs = defaults ?? EMPTY_DEFAULTS;
  const withoutSupplier = raw.split("@")[0] ?? raw;
  const beforeParen = withoutSupplier.split("(")[0] ?? withoutSupplier;
  const trimmed = beforeParen.trim();
  const hasLeadingSlash = trimmed.startsWith("/");
  const cleaned = trimmed.replace(/^\/+/, "");
  const segments = cleaned.split("/").filter((s) => s.length > 0);

  let layer = defs.layer;
  let variation = defs.variation;
  let platform = defs.platform;

  if (isProtocol) {
    let subject = "";
    const segs = [...segments];
    if (hasLeadingSlash && segs.length > 0) {
      layer = ApplyDefault(segs.shift(), defs.layer);
    }
    subject = ApplyDefault(segs.shift(), "");
    variation = ApplyDefault(segs.shift(), variation);
    platform = ApplyDefault(segs.shift(), platform);

    if (layer && subject && variation && platform) {
      return `/${layer}/${subject}/${variation}/${platform}`;
    }
    return null;
  }

  let verb = "";
  let subject = "";
  const segs = [...segments];
  if (hasLeadingSlash && segs.length > 0) {
    layer = ApplyDefault(segs.shift(), defs.layer);
  }
  verb = ApplyDefault(segs.shift(), "");
  subject = ApplyDefault(segs.shift(), "");
  variation = ApplyDefault(segs.shift(), variation);
  platform = ApplyDefault(segs.shift(), platform);

  if (layer && verb && subject && variation && platform) {
    return `/${layer}/${verb}/${subject}/${variation}/${platform}`;
  }
  return null;
}
