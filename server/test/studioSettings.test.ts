import { strict as assert } from "assert";
import {
  DEFAULT_STUDIO_CONNECTION,
  studioConfigFromInitialization,
  studioConfigUpdateFromSettings,
} from "../src/studioSettings";

describe("Studio-only configuration", () => {
  it("uses defaults when only removed gateway initialization options are present", () => {
    const result = studioConfigFromInitialization(
      { gateway: { hostname: "legacy.example", port: 1234, allowInsecure: false, network: "34" } },
      DEFAULT_STUDIO_CONNECTION
    );
    assert.deepEqual(result, DEFAULT_STUDIO_CONNECTION);
  });

  it("uses Studio initialization options", () => {
    const result = studioConfigFromInitialization(
      { studio: { hostname: "studio.example", port: 443, allowInsecure: false, network: "34" } },
      DEFAULT_STUDIO_CONNECTION
    );
    assert.deepEqual(result, { hostname: "studio.example", port: 443, allowInsecure: false, network: "34" });
  });

  it("ignores removed gateway settings during configuration changes", () => {
    assert.deepEqual(
      studioConfigUpdateFromSettings({ gateway: { hostname: "legacy.example", port: 1234, allowInsecure: false, network: "34" } }),
      {}
    );
  });

  it("uses only Studio settings during configuration changes", () => {
    assert.deepEqual(
      studioConfigUpdateFromSettings({ studio: { hostname: "studio.example", port: 443, allowInsecure: false, network: "34" } }),
      { hostname: "studio.example", port: 443, allowInsecure: false, network: "34" }
    );
  });
});
