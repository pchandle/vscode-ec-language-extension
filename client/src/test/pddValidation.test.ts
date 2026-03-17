import * as assert from "assert";
import * as vscode from "vscode";
import { collectPddSemanticDiagnostics } from "../customEditors/pddValidation";

suite("PDD semantic validation", () => {
  test("reports duplicate mode template names", () => {
    const diagnostics = collectPddSemanticDiagnostics({
      protocolDesignVersion: 1,
      hostMacroGlobal: {
        def: "def ($TOPICS)",
        header: "header",
        footer: "footer",
      },
      joinMacroGlobal: {
        def: "def ($TOPICS)",
        header: "header",
        footer: "footer",
      },
      modeTemplates: [
        {
          name: "shared",
          topics: [],
          hostMacroTemplates: [],
          joinMacroTemplates: [],
        },
        {
          name: "shared",
          topics: [],
          hostMacroTemplates: [],
          joinMacroTemplates: [],
        },
      ],
    });

    assert.ok(
      diagnostics.some(
        (item) => item.message.includes("must be unique") && item.severity === vscode.DiagnosticSeverity.Error
      )
    );
  });

  test("warns for out-of-range topic tokens and missing $TOPICS", () => {
    const diagnostics = collectPddSemanticDiagnostics({
      protocolDesignVersion: 1,
      hostMacroGlobal: {
        def: "def (acs, trigger)",
        header: "header",
        footer: "footer",
      },
      joinMacroGlobal: {
        def: "def (acs, $TOPICS, trigger)",
        header: "header",
        footer: "footer",
      },
      modeTemplates: [
        {
          name: "alpha",
          topics: [
            {
              name: "one",
              role: "host",
              constraint: "requirement",
              type: "integer",
            },
          ],
          hostMacroTemplates: ["sub /x($TOPIC_4)"],
          joinMacroTemplates: [],
        },
      ],
    });

    assert.ok(
      diagnostics.some(
        (item) =>
          item.message.includes("should contain $TOPICS") && item.severity === vscode.DiagnosticSeverity.Warning
      )
    );
    assert.ok(
      diagnostics.some(
        (item) => item.message.includes("$TOPIC_4") && item.severity === vscode.DiagnosticSeverity.Warning
      )
    );
  });
});
