import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { activate, doc, getDocUri, setTestContent } from "./helper";

type FormattingFixture = {
  name: string;
  file: string;
  kind: "document" | "range";
  inputLines: string[];
  expectedLines: string[];
  expectEdits?: boolean;
  range?: {
    startLine: number;
    endLine: number;
  };
};

suite("Should format emergent documents", () => {
  const fixtures = loadFixtures();

  for (const fixture of fixtures) {
    test(fixture.name, async () => {
      const docUri = getDocUri(fixture.file);
      await activate(docUri);
      const original = doc.getText();

      try {
        await setTestContent(joinLines(fixture.inputLines));

        const firstEdits = await executeFormatting(docUri, fixture);
        const firstEditCount = countEdits(firstEdits);
        const expectEdits = fixture.expectEdits ?? true;

        if (expectEdits) {
          assert.ok(firstEditCount > 0, "expected formatting edits");
          await applyFormattingEdits(docUri, firstEdits);
        } else {
          assert.equal(firstEditCount, 0, "expected already formatted input to produce no edits");
        }

        assert.equal(normalizeText(doc.getText()), joinLines(fixture.expectedLines));

        const secondEdits = await executeFormatting(docUri, fixture);
        assert.equal(countEdits(secondEdits), 0, "expected formatting to be idempotent");
      } finally {
        await setTestContent(original);
      }
    });
  }
});

function loadFixtures(): FormattingFixture[] {
  const fixturesPath = path.resolve(__dirname, "../../testFixture/formatting/fixtures.json");
  return JSON.parse(fs.readFileSync(fixturesPath, "utf8")) as FormattingFixture[];
}

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function countEdits(edits: readonly vscode.TextEdit[] | undefined): number {
  return edits?.length ?? 0;
}

async function executeFormatting(
  docUri: vscode.Uri,
  fixture: FormattingFixture
): Promise<readonly vscode.TextEdit[] | undefined> {
  if (fixture.kind === "range") {
    assert.ok(fixture.range, "expected range formatting fixture to include a range");
    const endCharacter = doc.lineAt(fixture.range.endLine).text.length;
    return vscode.commands.executeCommand<readonly vscode.TextEdit[]>(
      "vscode.executeFormatRangeProvider",
      docUri,
      new vscode.Range(
        new vscode.Position(fixture.range.startLine, 0),
        new vscode.Position(fixture.range.endLine, endCharacter)
      ),
      { tabSize: 2, insertSpaces: true }
    );
  }

  return vscode.commands.executeCommand<readonly vscode.TextEdit[]>(
    "vscode.executeFormatDocumentProvider",
    docUri,
    { tabSize: 2, insertSpaces: true }
  );
}

async function applyFormattingEdits(
  docUri: vscode.Uri,
  edits: readonly vscode.TextEdit[] | undefined
): Promise<void> {
  if (!edits || edits.length === 0) {
    return;
  }

  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.set(docUri, [...edits]);
  await vscode.workspace.applyEdit(workspaceEdit);
}
