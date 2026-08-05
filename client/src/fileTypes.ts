import * as path from "path";

/**
 * Canonical runtime names for the extension's standard file types.  VS Code's
 * package manifest must repeat these as static contribution patterns, so tests
 * keep that declaration in step with this registry.
 */
export const FILE_TYPES = {
  protocolDesign: { extension: ".pdes", editorViewType: "protocolDesignEditor" },
  protocolSpecification: { extension: ".pspec", editorViewType: "protocolSpecEditor" },
  contractSpecification: { extension: ".cspec", editorViewType: "contractSpecEditor" },
  protocolDesignDefinition: { extension: ".pdd", editorViewType: "protocolDesignDefinitionEditor" },
} as const;

export type StandardFileType = keyof typeof FILE_TYPES;
export type ComponentFileType = "protocolDesign" | "protocolSpecification" | "contractSpecification" | "autopilotExpression";

export const DEFAULT_AUTOPILOT_EXTENSION = ".dla";

export function normalizeExtension(value: string | undefined, fallback = ""): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return fallback;
  return (trimmed.startsWith(".") ? trimmed : `.${trimmed}`).toLowerCase();
}

export function extensionFor(type: StandardFileType): string {
  return FILE_TYPES[type].extension;
}

export function extensionWithoutDot(type: StandardFileType): string {
  return extensionFor(type).slice(1);
}

export function standardFileTypeForPath(filePath: string): StandardFileType | undefined {
  const extension = path.extname(filePath).toLowerCase();
  return (Object.keys(FILE_TYPES) as StandardFileType[]).find((type) => FILE_TYPES[type].extension === extension);
}

export function isFileType(filePath: string, type: StandardFileType): boolean {
  return standardFileTypeForPath(filePath) === type;
}

/** Standard types take precedence if an autopilot setting collides with one. */
export function componentFileTypeForPath(filePath: string, autopilotExtension: string): ComponentFileType | undefined {
  const standard = standardFileTypeForPath(filePath);
  if (standard === "protocolDesign" || standard === "protocolSpecification" || standard === "contractSpecification") return standard;
  return path.extname(filePath).toLowerCase() === normalizeExtension(autopilotExtension, DEFAULT_AUTOPILOT_EXTENSION)
    ? "autopilotExpression"
    : undefined;
}

export function editorViewTypeForPath(filePath: string): string | undefined {
  const type = standardFileTypeForPath(filePath);
  return type ? FILE_TYPES[type].editorViewType : undefined;
}

export function replaceExtension(filePath: string, type: StandardFileType): string {
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${extensionFor(type)}`);
}
