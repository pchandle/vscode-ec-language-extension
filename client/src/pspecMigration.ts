import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parseTree } from "jsonc-parser";
import { restoreLosslessIntegerFields } from "./customEditors/losslessIntegerFields";
import { loadSchema } from "./customEditors/SpecEditorProvider";
import { loadPdesSchema } from "./customEditors/PdesEditorProvider";
import { loadPddCandidates, ProtocolDesignDefinition } from "./pddLoader";
import { isFileType, replaceExtension } from "./fileTypes";
import {
  MigrationChoices,
  Pspec,
  PspecMigrationPlan,
  normalizeLegacyPspec,
  transformPspecToPdes,
} from "./pdes/migration";

type PddChoice = { path: string; definition: ProtocolDesignDefinition };
type ReviewMessage =
  | { type: "ready" }
  | { type: "selectDefinition"; definitionIndex: number }
  | { type: "update"; definitionIndex: number; choices: MigrationChoices }
  | { type: "create"; definitionIndex: number; choices: MigrationChoices }
  | { type: "cancel" };

type ReviewState = {
  type: "state";
  sourceName: string;
  targetName: string;
  definitions: Array<{ path: string; version: number }>;
  definitionIndex: number;
  plan: PspecMigrationPlan;
  sourceWarnings: string[];
};

type SchemaErrorLike = { instancePath?: string; keyword?: string; message?: string };

export function siblingPdesPath(sourcePath: string): string {
  return replaceExtension(sourcePath, "protocolDesign");
}

export function canOfferPdesMigration(sourcePath: string, exists: (filePath: string) => boolean = fs.existsSync): boolean {
  return isFileType(sourcePath, "protocolSpecification") && !exists(siblingPdesPath(sourcePath));
}

/** Atomically creates a migration target without ever replacing an existing file. */
export async function writeNewPdes(targetPath: string, design: unknown): Promise<"created" | "exists"> {
  try {
    await fs.promises.writeFile(targetPath, `${JSON.stringify(design, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return "created";
  } catch (error: any) {
    if (error?.code === "EEXIST") {
      return "exists";
    }
    throw error;
  }
}

/** Suppress the schema's known false-positive for the implicit protocol endpoint. */
export function collectPspecMigrationSchemaWarnings(pspec: Pspec, errors: readonly SchemaErrorLike[]): string[] {
  return errors
    .filter((error) => !isCanonicalSelfNamePatternError(pspec, error))
    .map((error) => `${error.instancePath || "/"}: ${error.message ?? "schema validation error"}`);
}

function isCanonicalSelfNamePatternError(pspec: Pspec, error: SchemaErrorLike): boolean {
  if (error.keyword !== "pattern") {
    return false;
  }
  const match = error.instancePath?.match(/^\/(host|join)\/(requirements|obligations)\/(\d+)\/name$/);
  if (!match) {
    return false;
  }
  const [, role, collection, indexText] = match;
  const endpointIsInCanonicalPosition =
    (role === "host" && collection === "obligations") || (role === "join" && collection === "requirements");
  if (!endpointIsInCanonicalPosition) {
    return false;
  }
  const topic = pspec[role as "host" | "join"]?.[collection as "requirements" | "obligations"]?.[Number(indexText)];
  return topic?.type === "abstraction" && topic.name === "<self>" && topic.protocol === pspec.name;
}

export function registerPspecMigration(context: vscode.ExtensionContext): (document: vscode.TextDocument) => Promise<void> {
  return async (document) => {
    const sourcePath = document.uri.fsPath;
    const targetPath = siblingPdesPath(sourcePath);
    if (!canOfferPdesMigration(sourcePath)) {
      void vscode.window.showWarningMessage(`${path.basename(targetPath)} already exists; it will not be overwritten.`);
      return;
    }

    let parsed: unknown;
    try {
      const text = document.getText();
      parsed = JSON.parse(text);
      restoreLosslessIntegerFields(text, parsed, parseTree(text) ?? undefined, "specification");
    } catch (error: any) {
      void vscode.window.showErrorMessage(`Cannot migrate invalid JSON: ${error?.message ?? String(error)}`);
      return;
    }
    const pspec = normalizeLegacyPspec(parsed);
    if (!pspec || pspec.type !== "protocol" || typeof pspec.name !== "string" || !pspec.host || !pspec.join) {
      void vscode.window.showErrorMessage("Cannot migrate: the file does not contain a protocol with host and join sections.");
      return;
    }

    const schema = loadSchema(context, "protocolSpec.schema.json");
    if (!schema) {
      return;
    }
    const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const sourceWarnings = validate(pspec) ? [] : collectPspecMigrationSchemaWarnings(pspec, validate.errors ?? []);

    const definitions: PddChoice[] = loadPddCandidates(context)
      .filter((candidate) => Boolean(candidate.definition))
      .map((candidate) => ({ path: candidate.path, definition: candidate.definition! }));
    if (definitions.length === 0) {
      void vscode.window.showErrorMessage("Cannot migrate because no valid protocol design definition (.pdd) is available.");
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "emergentPspecMigration",
      `Create .pdes from ${path.basename(sourcePath)}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    let definitionIndex = 0;
    let lastChoices: MigrationChoices = {};

    const state = (): ReviewState => ({
      type: "state",
      sourceName: path.basename(sourcePath),
      targetName: path.basename(targetPath),
      definitions: definitions.map((definition) => ({ path: definition.path, version: definition.definition.protocolDesignVersion })),
      definitionIndex,
      plan: transformPspecToPdes(pspec, definitions[definitionIndex].definition, lastChoices),
      sourceWarnings,
    });
    const postState = () => void panel.webview.postMessage(state());
    panel.webview.html = getReviewHtml(panel.webview);
    panel.webview.onDidReceiveMessage(async (message: ReviewMessage) => {
      if (message.type === "ready") {
        postState();
        return;
      }
      if (message.type === "cancel") {
        panel.dispose();
        return;
      }
      if (message.type === "selectDefinition") {
        if (Number.isInteger(message.definitionIndex) && definitions[message.definitionIndex]) {
          definitionIndex = message.definitionIndex;
          lastChoices = {};
        }
        postState();
        return;
      }
      if (message.type !== "update" && message.type !== "create") {
        return;
      }
      if (Number.isInteger(message.definitionIndex) && definitions[message.definitionIndex]) {
        definitionIndex = message.definitionIndex;
      }
      lastChoices = message.choices ?? {};
      const migration = transformPspecToPdes(pspec, definitions[definitionIndex].definition, lastChoices);
      if (message.type === "update") {
        postState();
        return;
      }
      if (!migration.canCreate) {
        postState();
        return;
      }
      const pdesSchema = loadPdesSchema(context);
      if (!pdesSchema) {
        return;
      }
      const pdesAjv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
      addFormats(pdesAjv);
      const validatePdes = pdesAjv.compile(pdesSchema);
      if (!validatePdes(migration.design)) {
        const messages = (validatePdes.errors ?? []).map((error) => `${error.instancePath || "/"}: ${error.message}`);
        void vscode.window.showErrorMessage(`Migration result is not a valid .pdes: ${messages.join("; ")}`);
        return;
      }
      try {
        const writeResult = await writeNewPdes(targetPath, migration.design);
        if (writeResult === "exists") {
          void vscode.window.showErrorMessage(`${path.basename(targetPath)} was created while migration was open; it was not overwritten.`);
          panel.dispose();
          return;
        }
      } catch (error: any) {
        void vscode.window.showErrorMessage(`Failed to create ${path.basename(targetPath)}: ${error?.message ?? String(error)}`);
        return;
      }
      panel.dispose();
      const targetUri = vscode.Uri.file(targetPath);
      await vscode.commands.executeCommand("vscode.openWith", targetUri, "protocolDesignEditor");
      void vscode.window.showInformationMessage(`Created ${path.basename(targetPath)} from ${path.basename(sourcePath)}.`);
    });
  };
}

function getReviewHtml(webview: vscode.Webview): string {
  const nonce = Array.from({ length: 32 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 62))).join("");
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:16px;max-width:1000px;margin:auto}select,input,button{font:inherit;padding:6px}section{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:12px;margin:12px 0}h1{font-size:1.35em}h2{font-size:1.1em;margin-top:0}.warning{color:var(--vscode-editorWarning-foreground)}.error{color:var(--vscode-errorForeground)}.mode{padding:8px;border-top:1px solid var(--vscode-panel-border)}.source{font-family:var(--vscode-editor-font-family);font-size:.9em}.actions{display:flex;gap:8px;justify-content:flex-end}pre{white-space:pre-wrap;max-height:280px;overflow:auto;background:var(--vscode-textCodeBlock-background);padding:8px}</style>
</head><body><div id="root">Loading migration review…</div><script nonce="${nonce}">
const vscode=acquireVsCodeApi();let state;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const choices=()=>{const modeTemplates={},labels={};document.querySelectorAll('[data-mode]').forEach(el=>{const i=el.dataset.mode;const select=el.querySelector('select');const input=el.querySelector('input');if(select)modeTemplates[i]=select.value;if(input)labels[i]=input.value;});return{modeTemplates,labels};};
const render=()=>{const p=state.plan;const sourceIssues=(state.sourceWarnings||[]).map(message=>'<li class="warning">Legacy schema: '+escape(message)+'</li>').join('');const planIssues=p.issues.map(i=>'<li class="'+i.severity+'">'+escape(i.message)+'</li>').join('');const issues=sourceIssues+planIssues||'<li>No migration issues detected.</li>';const modes=p.modes.map((m,i)=>'<div class="mode" data-mode="'+i+'"><strong>Mode '+(i+1)+'</strong> '+(m.inferred?'(inferred)':'(choose a mode)')+(m.candidates?'<div><label>Mode template <select>'+m.candidates.map(c=>'<option value="'+escape(c)+'" '+(m.modeTemplate===c?'selected':'')+'>'+escape(c)+'</option>').join('')+'</select></label></div>':'<div>Template: '+escape(m.modeTemplate)+'</div>')+'<div><label>Collaboration label <input value="'+escape(m.collaborationLabel)+'" placeholder="Required"></label></div><div class="source">'+m.sourceTopicIds.map(escape).join(', ')+'</div><ul>'+m.topics.map(t=>'<li>'+escape(t.name)+'</li>').join('')+'</ul></div>').join('');document.getElementById('root').innerHTML='<h1>Create '+escape(state.targetName)+'</h1><p>Review the inferred design before it is created. Existing files are never overwritten.</p><section><label>Protocol design definition <select id="definition">'+state.definitions.map((d,i)=>'<option value="'+i+'" '+(i===state.definitionIndex?'selected':'')+'>v'+d.version+' — '+escape(d.path)+'</option>').join('')+'</select></label></section><section><h2>Review issues</h2><ul>'+issues+'</ul></section><section><h2>Detected modes</h2>'+modes+'</section><section><h2>Generated .pdes preview</h2><pre>'+escape(JSON.stringify(p.design,null,2))+'</pre></section><div class="actions"><button id="cancel">Cancel</button><button id="update">Update preview</button><button id="create" '+(p.canCreate?'':'disabled')+'>Create .pdes</button></div>';document.getElementById('definition').onchange=e=>vscode.postMessage({type:'selectDefinition',definitionIndex:Number(e.target.value)});document.getElementById('cancel').onclick=()=>vscode.postMessage({type:'cancel'});document.getElementById('update').onclick=()=>vscode.postMessage({type:'update',definitionIndex:Number(document.getElementById('definition').value),choices:choices()});document.getElementById('create').onclick=()=>vscode.postMessage({type:'create',definitionIndex:Number(document.getElementById('definition').value),choices:choices()});};
window.addEventListener('message',event=>{state=event.data;render()});vscode.postMessage({type:'ready'});
</script></body></html>`;
}
