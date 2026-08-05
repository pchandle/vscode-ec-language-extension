import * as assert from "assert";
import * as vscode from "vscode";
import { componentManagerSourceViewColumn, renderContractExpressionDirectory, renderContractExpressionSkeleton, validateContractExpressionPathTemplate } from "../componentManager";

suite("Component Manager contract expression helpers", () => {
  test("opens source navigation in the active group unless beside is requested", () => {
    assert.equal(componentManagerSourceViewColumn(), vscode.ViewColumn.Active);
    assert.equal(componentManagerSourceViewColumn(true), vscode.ViewColumn.Beside);
  });

  test("renders the configured directory template from a contract classification", () => {
    assert.equal(
      renderContractExpressionDirectory("/system/log/hash/default/x64", "{layer}/{verb}/{subject}/{variation}/{platform}"),
      "system/log/hash/default/x64"
    );
  });

  test("rejects unsafe and unsupported expression directory templates", () => {
    assert.ok(validateContractExpressionPathTemplate("../{layer}"));
    assert.ok(validateContractExpressionPathTemplate("{supplier}/{layer}"));
    assert.equal(validateContractExpressionPathTemplate("{layer}/{verb}"), undefined);
  });

  test("creates a deterministic job skeleton from contract topics", () => {
    const result = renderContractExpressionSkeleton(
      "/system/log/hash/default/x64",
      [{ name: "Log value" }, { name: "Log value" }],
      [{ name: "Result value" }]
    );

    assert.equal(result, "job /system/log/hash/default/x64(log_value, log_value_2) -> result_value:\nend\n");
  });
});
