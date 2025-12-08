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
  const cleaned = beforeParen.trim().replace(/^\/+/, "");
  const segments = cleaned.split("/").filter((s) => s.length > 0);

  let layer = ApplyDefault(defs.layer, defs.layer);
  let variation = ApplyDefault(defs.variation, defs.variation);
  let platform = ApplyDefault(defs.platform, defs.platform);

  if (isProtocol) {
    let subject = "";
    if (segments.length >= 4) {
      [layer, subject, variation, platform] = segments;
    } else if (segments.length === 3) {
      const [a, b, c] = segments;
      if (ApplyDefault(a, layer) === layer) {
        layer = a;
        subject = b;
        variation = c;
      } else {
        subject = a;
        variation = b;
        platform = c;
      }
    } else if (segments.length === 2) {
      const [a, b] = segments;
      if (ApplyDefault(a, layer) === layer) {
        layer = a;
        subject = b;
      } else {
        subject = a;
        variation = b;
      }
    } else if (segments.length === 1) {
      subject = segments[0];
    }
    layer = ApplyDefault(layer, defs.layer);
    subject = ApplyDefault(subject, "");
    variation = ApplyDefault(variation, defs.variation);
    platform = ApplyDefault(platform, defs.platform);
    if (layer && subject && variation && platform) {
      return `/${layer}/${subject}/${variation}/${platform}`;
    }
    return null;
  }

  let verb = "";
  let subject = "";
  if (segments.length >= 5) {
    [layer, verb, subject, variation, platform] = segments;
  } else if (segments.length === 4) {
    const [a, b, c, d] = segments;
    if (ApplyDefault(a, layer) === layer) {
      layer = a;
      verb = b;
      subject = c;
      variation = d;
      // platform default
    } else {
      verb = a;
      subject = b;
      variation = c;
      platform = d;
    }
  } else if (segments.length === 3) {
    const [a, b, c] = segments;
    if (ApplyDefault(a, layer) === layer) {
      layer = a;
      verb = b;
      subject = c;
    } else {
      verb = a;
      subject = b;
      variation = c;
    }
  } else if (segments.length === 2) {
    const [a, b] = segments;
    if (ApplyDefault(a, layer) === layer) {
      layer = a;
      verb = b;
    } else {
      verb = a;
      subject = b;
    }
  } else if (segments.length === 1) {
    verb = segments[0];
  }

  layer = ApplyDefault(layer, defs.layer);
  verb = ApplyDefault(verb, "");
  subject = ApplyDefault(subject, "");
  variation = ApplyDefault(variation, defs.variation);
  platform = ApplyDefault(platform, defs.platform);

  if (layer && verb && subject && variation && platform) {
    return `/${layer}/${verb}/${subject}/${variation}/${platform}`;
  }
  return null;
}
