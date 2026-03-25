import { Position, Range, TextEdit } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

function formatLine(text: string): string {
  if (text.match(/^\s*\/\//)) {
    return text;
  }

  let formatted = text;
  formatted = formatted.replace(/([^^\s])\s{2,}/g, "$1 ");
  formatted = formatted.replace(/\s{0,},\s{0,}/g, ", ");
  formatted = formatted.replace(/\s*->\s*/g, " -> ");
  formatted = formatted.replace(/\s+$/g, "");
  return formatted;
}

export function formatDocument(document: TextDocument): TextEdit[] {
  const edits: TextEdit[] = [];

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const line = document.getText({
      start: Position.create(lineIndex, 0),
      end: Position.create(lineIndex + 1, 0),
    });
    const originalText = line.endsWith("\n") ? line.slice(0, -1) : line;
    const formattedText = formatLine(originalText);

    if (formattedText !== originalText) {
      edits.push(
        TextEdit.replace(
          Range.create(
            Position.create(lineIndex, 0),
            Position.create(lineIndex, originalText.length)
          ),
          formattedText
        )
      );
    }
  }

  return edits;
}
