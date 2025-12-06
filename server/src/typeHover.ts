import { Position, Range } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parseText } from "./lang/parser";
import { TypeAtPosition, TypeKind, typeCheckProgram, typeToDisplayString } from "./lang/typeChecker";
import { RemoteContractSpec } from "./gatewayClient";

function rangeContains(range: Range, position: Position): boolean {
  if (position.line < range.start.line || position.line > range.end.line) return false;
  if (position.line === range.start.line && position.character < range.start.character) return false;
  if (position.line === range.end.line && position.character > range.end.character) return false;
  return true;
}

function rangeSize(range: Range): number {
  const lineDelta = range.end.line - range.start.line;
  const charDelta = range.end.character - range.start.character;
  return lineDelta * 1000 + charDelta;
}

function hasKnownType(types: TypeAtPosition["types"]): boolean {
  return types.some((t) => t.kind !== TypeKind.Unknown);
}

function pickBestType(types: TypeAtPosition[], position: Position): TypeAtPosition | undefined {
  let best: TypeAtPosition | undefined;
  let bestSize = Number.POSITIVE_INFINITY;
  for (const entry of types) {
    if (!rangeContains(entry.range, position)) continue;
    const size = rangeSize(entry.range);
    const known = hasKnownType(entry.types);
    const bestKnown = best ? hasKnownType(best.types) : false;
    if (
      size < bestSize ||
      (size === bestSize && known && !bestKnown)
    ) {
      best = entry;
      bestSize = size;
    }
  }
  return best;
}

function formatTypes(types: TypeAtPosition["types"]): string {
  if (!types.length) return "UNKNOWN";
  if (types.length === 1) return typeToDisplayString(types[0]);
  return `(${types.map(typeToDisplayString).join(", ")})`;
}

export function getTypeHoverMarkdown(
  document: TextDocument,
  position: Position,
  contractSpecs?: Record<string, RemoteContractSpec>
): string | null {
  const { program } = parseText(document.getText());
  const { types } = typeCheckProgram(program, { collectTypes: true, contractSpecs });
  if (!types?.length) return null;
  const best = pickBestType(types, position);
  if (!best) return null;
  return `**Type**: \`${formatTypes(best.types)}\``;
}
