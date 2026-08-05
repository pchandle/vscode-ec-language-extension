import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import {
  componentFileTypeForPath,
  editorViewTypeForPath,
  extensionFor,
  FILE_TYPES,
  isFileType,
  replaceExtension,
} from "../fileTypes";

suite("file type registry", () => {
  test("classifies standard and configured component file types case-insensitively", () => {
    assert.equal(componentFileTypeForPath("/components/alpha.PDES", ".dla"), "protocolDesign");
    assert.equal(componentFileTypeForPath("/components/alpha.pspec", ".dla"), "protocolSpecification");
    assert.equal(componentFileTypeForPath("/components/alpha.cspec", ".dla"), "contractSpecification");
    assert.equal(componentFileTypeForPath("/components/alpha.dla", "dla"), "autopilotExpression");
    assert.equal(componentFileTypeForPath("/components/alpha.txt", ".dla"), undefined);
  });

  test("uses semantic roles for editor selection and sibling names", () => {
    assert.equal(editorViewTypeForPath("/components/alpha.pdes"), "protocolDesignEditor");
    assert.equal(editorViewTypeForPath("/components/alpha.cspec"), "contractSpecEditor");
    assert.equal(isFileType("/components/alpha.pspec", "protocolSpecification"), true);
    assert.equal(replaceExtension("/components/alpha.pspec", "protocolDesign"), path.join("/components", "alpha.pdes"));
  });

  test("matches static language and custom-editor declarations in the manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"));
    const languageExtensions: string[] = manifest.contributes.languages.find((language: any) => language.id === "emergent").extensions;
    assert.ok(languageExtensions.includes(extensionFor("contractSpecification")));
    assert.ok(languageExtensions.includes(extensionFor("protocolSpecification")));

    const editors: Array<{ viewType: string; selector: Array<{ filenamePattern: string }> }> = manifest.contributes.customEditors;
    (Object.entries(FILE_TYPES) as Array<[keyof typeof FILE_TYPES, typeof FILE_TYPES[keyof typeof FILE_TYPES]]>).forEach(([, fileType]) => {
      const editor = editors.find((candidate) => candidate.viewType === fileType.editorViewType);
      assert.ok(editor, `Missing editor declaration for ${fileType.editorViewType}`);
      assert.ok(editor!.selector.some((selector) => selector.filenamePattern === `*${fileType.extension}`));
    });
  });
});
