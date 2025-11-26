import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface MacroGlobal {
  def: string;
  header: string;
  footer: string;
  [key: string]: unknown;
}

export interface ModeTemplateTopic {
  name: string;
  role: "host" | "join";
  constraint: "requirement" | "obligation";
  type: string;
  [key: string]: unknown;
}

export interface ModeTemplate {
  name: string;
  topics?: ModeTemplateTopic[];
  hostMacroTemplates?: string[];
  joinMacroTemplates?: string[];
  [key: string]: unknown;
}

export interface ProtocolDesignDefinition {
  protocolDesignVersion: number;
  hostMacroGlobal?: MacroGlobal;
  joinMacroGlobal?: MacroGlobal;
  modeTemplates?: ModeTemplate[];
  [key: string]: unknown;
}

export interface LoadedPdd {
  path: string;
  definition?: ProtocolDesignDefinition;
  error?: string;
}

const BUNDLED_PDD_RELATIVE = path.join("resources", "pdd", "default.pdd");

function resolvePath(inputPath: string, context: vscode.ExtensionContext): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    return path.join(workspaceRoot, inputPath);
  }

  return path.join(context.extensionPath, inputPath);
}

function readJsonFile(filePath: string): LoadedPdd {
  try {
    const contents = fs.readFileSync(filePath, "utf8");
    const definition = JSON.parse(contents) as ProtocolDesignDefinition;
    return { path: filePath, definition };
  } catch (error: any) {
    return { path: filePath, error: error?.message ?? String(error) };
  }
}

export function loadPddCandidates(context: vscode.ExtensionContext): LoadedPdd[] {
  const config = vscode.workspace.getConfiguration("protocolDesign");
  const configuredPaths = (config.get<string[]>("definitionPaths") ?? []).filter(Boolean);
  const activeOverride = config.get<string>("activeDefinition");

  const candidatePaths: string[] = [];
  if (activeOverride) {
    candidatePaths.push(activeOverride);
  }
  candidatePaths.push(...configuredPaths);
  candidatePaths.push(path.join(context.extensionPath, BUNDLED_PDD_RELATIVE));

  const seen = new Set<string>();
  const results: LoadedPdd[] = [];

  for (const p of candidatePaths) {
    const resolved = resolvePath(p, context);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    if (!fs.existsSync(resolved)) {
      results.push({ path: resolved, error: "File does not exist" });
      continue;
    }
    results.push(readJsonFile(resolved));
  }

  return results;
}

export function findPddForVersion(
  context: vscode.ExtensionContext,
  version: number
): { match?: LoadedPdd; candidates: LoadedPdd[] } {
  const candidates = loadPddCandidates(context);
  const match = candidates.find((c) => c.definition?.protocolDesignVersion === version);
  return { match, candidates };
}
