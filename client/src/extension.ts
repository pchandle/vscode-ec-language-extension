/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from "path";
import { Valley, Contracts, ContractSpecification } from "./valley";
import { EmergentDocumentFormatter, EmergentDocumentRangeFormatter } from "./formatting";
import { workspace, ExtensionContext } from "vscode";

import * as vscode from "vscode";

import { InsertTextMode, LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";

let client: LanguageClient;
let ecStatusBarItem: vscode.StatusBarItem;

const statusText = "initialising...";
// const contractSpecs = [];

const v = new Valley();

const valleyScanIntervalMs = 30 * 60 * 1000;

function getDefaults(doc: vscode.TextDocument) {
  const defaults = doc
    .getText()
    .match(/(^|\n)\s*defaults:\s+(?<layer>[^ ,]*)\s*,\s*(?<variation>[^ ,]*)\s*,\s*(?<platform>[^ ,]*)\s*,\s*(?<supplier>\w*)/);
  // console.debug('defaults:', defaults ? defaults.groups : null);
  return defaults ? defaults.groups : null;
}
async function getContractHoverMarkdown(contract: any) {
  try {
    const spec = await v.fetchContractSpec(contract);
    // fetchContractRoutes(contract);

    if (!spec) {
      return;
    }
    const markdownString = new vscode.MarkdownString();
    // Description
    markdownString.appendMarkdown('<span style="color:#5E994F;"><em>Description</em></span><br>');
    // if (typeof spec.description == "object") {
    //   spec.description.forEach(function (line:string) {
    //     if (line != "") {
    //       markdownString.appendMarkdown("\t" + line + "<br>");
    //     }
    //   });
    // } else {
    markdownString.appendMarkdown("\t" + spec.description + "<br>");
    // }

    markdownString.appendMarkdown('<span style="color:#5E994F;"><em>Interface</em></span><br>');

    // Sub contract statement
    const valleyContractUrl = v.contractUrlByClassificationName(spec.name);
    markdownString.appendMarkdown(
      '<span style="color:#c586c0;">sub</span> <span style="color:#2e74a6;"><a href="' +
        valleyContractUrl +
        '">' +
        spec.name +
        "</a></span>(<br>"
    );
    // Requirements
    markdownString.appendMarkdown("<table>");
    spec.requirements.forEach(function (req) {
      // Each has name, type (abstraction, integer, string, boolean)
      //  where each type can have additional properties.
      markdownString.appendMarkdown("<tr>");
      markdownString.appendMarkdown("<td>" + req.name + "</td>");
      let valleyCollabUrl;
      switch (req.type) {
        case "abstraction":
          valleyCollabUrl = v.protocolUrlByClassificationName(req.protocol);
          markdownString.appendMarkdown(
            '<td>::<a href="' + valleyCollabUrl + '"><span style="color:#f27b39;">' + req.protocol + "</span></a></td>"
          );
          break;
        case "integer":
          markdownString.appendMarkdown('<td>::<span style="color:#cb3697;">INTEGER[' + req.hint + "]</span></td>");
          break;
        case "string":
          markdownString.appendMarkdown('<td>::<span style="color:#cb3697;">STRING[' + req.hint + "]</span></td>");
          break;
        case "boolean":
          markdownString.appendMarkdown('<td>::<span style="color:#cb3697;">BOOLEAN</span></td>');
          break;
        default:
          break;
      }

      markdownString.appendMarkdown("</tr>");
    });
    markdownString.appendMarkdown("</table>");

    // Symbolic arrow
    markdownString.appendMarkdown(") -></br>");

    // Obligations
    markdownString.appendMarkdown("<table>");

    spec.obligations.forEach(function (oblg) {
      // Each has name, type (abstraction, integer, string, boolean)
      //  where each type can have additional properties.
      markdownString.appendMarkdown("<tr>");
      markdownString.appendMarkdown("<td>" + oblg.name + "</td>");
      let valleyCollabUrl;
      switch (oblg.type) {
        case "abstraction":
          valleyCollabUrl = v.protocolUrlByClassificationName(oblg.protocol);
          markdownString.appendMarkdown(
            '<td>::<a href="' + valleyCollabUrl + '"><span style="color:#f27b39;">' + oblg.protocol + "</span></a></td>"
          );
          break;
        case "integer":
          markdownString.appendMarkdown('<td>::<span style="color:#cb3697;">INTEGER[' + oblg.hint + "]</span></td>");
          break;
        case "string":
          markdownString.appendMarkdown('<td>::<span style="color:#cb3697;">STRING[' + oblg.hint + "]</span></td>");
          break;
        case "boolean":
          markdownString.appendMarkdown('<td>::<span style="color:#cb3697;">BOOLEAN</span></td>');
          break;
        default:
          break;
      }
      markdownString.appendMarkdown("</tr>");
    });
    markdownString.appendMarkdown("</table>");

    markdownString.appendMarkdown('<span style="color:#5E994F;"><em>Suppliers</em></span><br>');
    spec.suppliers.forEach(function (supplier, index, supArray) {
      markdownString.appendMarkdown(supplier);
      if (index != supArray.length - 1) {
        markdownString.appendMarkdown(", ");
      }
    });

    // `<span style="color:#000;background-color:#fff;">Howdy there.</span>`;
    // description[]
    // requirements[]
    // obligations[]
    // suppliers[]
    markdownString.supportHtml = true;
    // markdownString.isTrusted = true;

    return markdownString;
  } catch (error) {
    console.log(error.message);
    return;
  }
}

export function activate(context: ExtensionContext) {
  console.debug("Activating 'emergent' language extension.");

  // The server is implemented in node
  const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
  // The debug options for the server
  // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
  const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for plain text documents
    documentSelector: [{ scheme: "file", language: "emergent" }],
    synchronize: {
      // Notify the server about file changes to '.clientrc files contained in the workspace
      fileEvents: workspace.createFileSystemWatcher("**/.clientrc"),
    },
  };

  // Create the language client and start the client.
  client = new LanguageClient("emergent", "Emergent Coding", serverOptions, clientOptions);

  // Start the client. This will also launch the server
  console.debug("Starting 'emergent' language server.");

  client.start();

  // **** CUSTOM EMERGENT CODING CODE COMPLETION ***
  // const provider1 = vscode.languages.registerCompletionItemProvider('emergent', {

  // 	provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {

  // 		// a simple completion item which inserts `Hello World!`
  // 		const simpleCompletion = new vscode.CompletionItem('Hello World!');

  // 		// a completion item that inserts its text as snippet,
  // 		// the `insertText`-property is a `SnippetString` which will be
  // 		// honored by the editor.
  // 		const snippetCompletion = new vscode.CompletionItem('Good part of the day');
  // 		snippetCompletion.insertText = new vscode.SnippetString('Good ${1|morning,afternoon,evening|}. It is ${1}, right?');
  // 		const docs : any = new vscode.MarkdownString("Inserts a snippet that lets you select [link](x.ts).");
  // 		snippetCompletion.documentation = docs;
  // 		docs.baseUri = vscode.Uri.parse('http://example.com/a/b/c/');

  // 		// a completion item that can be accepted by a commit character,
  // 		// the `commitCharacters`-property is set which means that the completion will
  // 		// be inserted and then the character will be typed.
  // 		const commitCharacterCompletion = new vscode.CompletionItem('console');
  // 		commitCharacterCompletion.commitCharacters = ['.'];
  // 		commitCharacterCompletion.documentation = new vscode.MarkdownString('Press `.` to get `console.`');

  // 		// a completion item that retriggers IntelliSense when being accepted,
  // 		// the `command`-property is set which the editor will execute after
  // 		// completion has been inserted. Also, the `insertText` is set so that
  // 		// a space is inserted after `new`
  // 		const commandCompletion = new vscode.CompletionItem('new');
  // 		commandCompletion.kind = vscode.CompletionItemKind.Keyword;
  // 		commandCompletion.insertText = 'new ';
  // 		commandCompletion.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completions...' };

  // 		// return all completion items as array
  // 		return [
  // 			simpleCompletion,
  // 			snippetCompletion,
  // 			commitCharacterCompletion,
  // 			commandCompletion
  // 		];
  // 	}
  // });

  const contractCompletionProvider = vscode.languages.registerCompletionItemProvider(
    "emergent",
    {
      provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token?: vscode.CancellationToken) {
        const range = new vscode.Range(new vscode.Position(position.line, 0), position);
        const text = document.getText(range);

        // if (!text.match(/^\s*s.*$/)) {
        //   return undefined;
        // }

        // 'sub' auto completion
        if (!text.match(/^\s*sub\s/)) {
          console.debug("pong");
          return undefined;
        } else {
          console.debug("ping");
          // Get defaults:
          const defaults = getDefaults(document);
          // const defaults = document.getText().match(/^\s*defaults:\s+([^ ,]*)\s*,\s*([^ ,]*)\s*,\s*([^ ,]*)\s*,\s*(\w*)/);

          // console.debug('defaults: ', defaults.layer, ",", defaults.variation, ",", defaults.platform, ",", defaults.supplier);

          // Get contract taxonomy
          // const taxonomy = text.match(/^\s*sub +(\/([^/]*)?(\/([^/]+)(\/([^/]+)(\/([^/]+)(\/([^@(]*)(@([^(]+))?)?)?)?)?)?/);
          const taxonomy = text.match(/^\s*sub +(\/([^/]*)\/?)?([^/]*)?\/?([^/@(]*)?\/?([^/@(]*)?\/?([^/@(]*)?@?([^(]*)?$/);
          // console.debug('taxonomy: ', taxonomy);
          const layer = taxonomy[2];
          const verb = taxonomy[3];
          const subject = taxonomy[4];
          const variation = taxonomy[5];
          const platform = taxonomy[6];
          const supplier = taxonomy[7];

          console.debug("L:", layer, " V:", verb, " Sb:", subject, " V:", variation, " P:", platform, "Sp:", supplier);

          const suggestedLayer = "";
          const suggestedVariation = "";
          const suggestedSupplier = "";

          const searchLayer = layer == undefined ? defaults.layer : layer == "." ? defaults.layer : layer;
          const searchVariation = variation == undefined ? defaults.variation : variation == "." ? defaults.variation : variation;
          const searchPlatform = platform == undefined ? defaults.platform : platform == "." ? defaults.platform : platform;

          /*
        Auto-complete strategy:
        - If no part of the classification has been provided, suggest (a) non-default layers and (b) default layer verbs
        - If verb is present, suggest subjects with matching layer/verb
        - If verb and subject is present, suggest (a) matching default specification and (b) matching non-default variations
        - If verb, subject and variation is present, suggest (a) matching default specification and (b) matching non-default platforms
        - If verb, subject, variation and platform are present, suggest (a) matching default supplier and (b) matching non-default suppliers.
        */

          const completionItems = [];

          if (
            layer == undefined &&
            verb == undefined &&
            subject == undefined &&
            variation == undefined &&
            platform == undefined &&
            supplier == undefined
          ) {
            // Suggest default layer verbs
            completionItems.push(...new Set(v.contracts.filter((item) => item.layer == defaults.layer).map((item) => item.verb)));
            console.debug("suggesting default layer verbs");
            // Suggest non-default layers
            completionItems.push(
              ...new Set(v.contracts.filter((item) => item.layer != defaults.layer).map((item) => "/" + item.layer + "/"))
            );
            console.debug("suggesting non-default layers");
          } else {
            if (
              layer != undefined &&
              verb == undefined &&
              subject == undefined &&
              variation == undefined &&
              platform == undefined &&
              supplier == undefined
            ) {
              // Suggest non-default layers
              completionItems.push(
                ...new Set(
                  v.contracts.filter((item) => item.layer != defaults.layer && item.layer != layer).map((item) => "/" + item.layer + "/")
                )
              );
              // Suggest verbs for exact layer match
              completionItems.push(
                ...new Set(v.contracts.filter((item) => item.layer == layer).map((item) => "/" + item.layer + "/" + item.verb))
              );
            } else {
              if (verb != undefined && subject == undefined && variation == undefined && platform == undefined && supplier == undefined) {
                // Suggest subjects with matching layer/verb
                const suggestedLayer = layer == undefined ? "" : "/" + layer + "/";
                completionItems.push(
                  ...new Set(
                    v.contracts
                      .filter((item) => item.layer == searchLayer && item.verb.startsWith(verb))
                      .map((item) => suggestedLayer + item.verb)
                  )
                );
                // Suggest subjects for exact verb match
                completionItems.push(
                  ...new Set(
                    v.contracts
                      .filter((item) => item.layer == searchLayer && item.verb == verb)
                      .map((item) => suggestedLayer + item.verb + "/" + item.subject)
                  )
                );
              } else {
                if (
                  verb != undefined &&
                  subject !== undefined &&
                  variation == undefined &&
                  platform == undefined &&
                  supplier == undefined
                ) {
                  // Suggest subjects for partial match and default variation/platform
                  const suggestedLayer = layer == undefined ? "" : "/" + layer + "/";
                  completionItems.push(
                    ...new Set(
                      v.contracts
                        .filter(
                          (item) =>
                            item.layer == searchLayer &&
                            item.verb == verb &&
                            item.subject.startsWith(subject) &&
                            item.variation == defaults.variation &&
                            item.platform == defaults.platform
                        )
                        .map((item) => {
                          // If the default supplier supplies this contract, use them
                          //  otherwise pick the first available supplier.
                          const p = suggestedLayer + item.verb + "/" + item.subject;
                          if (item.suppliers.includes(defaults.supplier)) {
                            return p + "@" + defaults.supplier;
                          } else {
                            if (item.suppliers[0]) {
                              return p + "@" + item.suppliers[0];
                            } else {
                              return p;
                            }
                          }
                        })
                    )
                  );
                  // Suggest subjects for exact match and default platform
                  completionItems.push(
                    ...new Set(
                      v.contracts
                        .filter(
                          (item) =>
                            item.layer == searchLayer &&
                            item.verb == verb &&
                            item.subject == subject &&
                            item.variation != defaults.variation &&
                            item.platform == defaults.platform
                        )
                        .map((item) => {
                          // If the default supplier supplies this contract, use them
                          //  otherwise pick the first available supplier.
                          const p = suggestedLayer + item.verb + "/" + item.subject + "/" + item.variation;
                          if (item.suppliers.includes(defaults.supplier)) {
                            return p + "@" + defaults.supplier;
                          } else {
                            if (item.suppliers[0]) {
                              return p + "@" + item.suppliers[0];
                            } else {
                              return p;
                            }
                          }
                        })
                    )
                  );
                  // Suggest subjects for exact match and default variation
                  completionItems.push(
                    ...new Set(
                      v.contracts
                        .filter(
                          (item) =>
                            item.layer == searchLayer &&
                            item.verb == verb &&
                            item.subject == subject &&
                            item.variation == defaults.variation &&
                            item.platform != defaults.platform
                        )
                        .map((item) => {
                          // If the default supplier supplies this contract, use them
                          //  otherwise pick the first available supplier.
                          const p = suggestedLayer + item.verb + "/" + item.subject + "/./" + item.platform;
                          if (item.suppliers.includes(defaults.supplier)) {
                            return p + "@" + defaults.supplier;
                          } else {
                            if (item.suppliers[0]) {
                              return p + "@" + item.suppliers[0];
                            } else {
                              return p;
                            }
                          }
                        })
                    )
                  );
                  // Suggest subjects for exact match and non-default variation/platform
                  completionItems.push(
                    ...new Set(
                      v.contracts
                        .filter(
                          (item) =>
                            item.layer == searchLayer &&
                            item.verb == verb &&
                            item.subject == subject &&
                            item.variation != defaults.variation &&
                            item.platform != defaults.platform
                        )
                        .map((item) => {
                          // If the default supplier supplies this contract, use them
                          //  otherwise pick the first available supplier.
                          const p = suggestedLayer + item.verb + "/" + item.subject + "/" + item.variation + "/" + item.platform;
                          if (item.suppliers.includes(defaults.supplier)) {
                            return p + "@" + defaults.supplier;
                          } else {
                            if (item.suppliers[0]) {
                              return p + "@" + item.suppliers[0];
                            } else {
                              return p;
                            }
                          }
                        })
                    )
                  );
                } else {
                  if (
                    verb != undefined &&
                    subject !== undefined &&
                    variation != undefined &&
                    platform == undefined &&
                    supplier == undefined
                  ) {
                    const suggestedLayer = layer == undefined ? "" : "/" + layer + "/";
                    const searchVariation = variation == "." ? defaults.variation : variation;

                    // Suggest variations for partial match with default platform
                    completionItems.push(
                      ...new Set(
                        v.contracts
                          .filter(
                            (item) =>
                              item.layer == searchLayer &&
                              item.verb == verb &&
                              item.subject == subject &&
                              item.variation != defaults.variation &&
                              item.variation.startsWith(searchVariation) &&
                              item.platform == defaults.platform
                          )
                          .map((item) => {
                            // If the default supplier supplies this contract, use them
                            //  otherwise pick the first available supplier.
                            const p = suggestedLayer + item.verb + "/" + item.subject + "/" + item.variation;
                            if (item.suppliers.includes(defaults.supplier)) {
                              return p + "@" + defaults.supplier;
                            } else {
                              if (item.suppliers[0]) {
                                return p + "@" + item.suppliers[0];
                              } else {
                                return p;
                              }
                            }
                          })
                      )
                    );

                    // Suggest variations for partial match with default variation
                    completionItems.push(
                      ...new Set(
                        v.contracts
                          .filter(
                            (item) =>
                              item.layer == searchLayer &&
                              item.verb == verb &&
                              item.subject == subject &&
                              item.variation == defaults.variation &&
                              item.variation.startsWith(searchVariation) &&
                              item.platform != defaults.platform
                          )
                          .map((item) => {
                            // If the default supplier supplies this contract, use them
                            //  otherwise pick the first available supplier.
                            const p = suggestedLayer + item.verb + "/" + item.subject + "/./" + item.platform;
                            if (item.suppliers.includes(defaults.supplier)) {
                              return p + "@" + defaults.supplier;
                            } else {
                              if (item.suppliers[0]) {
                                return p + "@" + item.suppliers[0];
                              } else {
                                return p;
                              }
                            }
                          })
                      )
                    );
                    // Suggest variations for exact match with non-default platform
                    completionItems.push(
                      ...new Set(
                        v.contracts
                          .filter(
                            (item) =>
                              item.layer == searchLayer &&
                              item.verb == verb &&
                              item.subject == subject &&
                              item.variation != defaults.variation &&
                              item.variation == searchVariation &&
                              item.platform != defaults.platform
                          )
                          .map((item) => {
                            // If the default supplier supplies this contract, use them
                            //  otherwise pick the first available supplier.
                            const p =
                              suggestedLayer +
                              item.verb +
                              "/" +
                              item.subject +
                              "/" +
                              (item.variation == defaults.variation ? "." : item.variation) +
                              "/" +
                              item.platform;
                            if (item.suppliers.includes(defaults.supplier)) {
                              return p + "@" + defaults.supplier;
                            } else {
                              if (item.suppliers[0]) {
                                return p + "@" + item.suppliers[0];
                              } else {
                                return p;
                              }
                            }
                          })
                      )
                    );
                  } else {
                    if (
                      verb != undefined &&
                      subject !== undefined &&
                      variation != undefined &&
                      platform != undefined &&
                      supplier == undefined
                    ) {
                      const suggestedLayer = layer == undefined ? "" : "/" + layer + "/";
                      const searchVariation = variation == "." ? defaults.variation : variation;

                      // Suggest platforms for partial match
                      completionItems.push(
                        ...new Set(
                          v.contracts
                            .filter(
                              (item) =>
                                item.layer == searchLayer &&
                                item.verb == verb &&
                                item.subject == subject &&
                                item.variation == searchVariation &&
                                item.platform.startsWith(platform)
                            )
                            .map((item) => {
                              // If the default supplier supplies this contract, use them
                              //  otherwise pick the first available supplier.
                              const p =
                                suggestedLayer +
                                item.verb +
                                "/" +
                                item.subject +
                                "/" +
                                (item.variation == defaults.variation ? "." : item.variation) +
                                "/" +
                                item.platform;
                              if (item.suppliers.includes(defaults.supplier)) {
                                return p + "@" + defaults.supplier;
                              } else {
                                if (item.suppliers[0]) {
                                  return p + "@" + item.suppliers[0];
                                } else {
                                  return p;
                                }
                              }
                            })
                        )
                      );
                    } else {
                      console.debug("nope");
                    }
                  }
                }
              }
            }
          }

          console.debug("completion items: ", completionItems);

          const completionItemList: vscode.CompletionItem[] = completionItems.map((item, idx) => ({
            label: item,
            preselect: idx === 0,
            documentation: "My dedicated VsCode plug-ins provider",
            sortText: `my_completion_${idx}`,
          }));
          return completionItemList;
        }

        // // 'Layer' auto completion
        // if (text.match(/.*sub +\/[^/]*$/)) {
        // 	const layer = text.match(/.*sub +\/([^/]*)/)[1];
        // 	console.debug('layer: ', layer);
        // 	const completionItems = [];
        // 	completionItems.push([...new Set(contractSpecs.filter(item => item.layer.startsWith(layer)).map(item => item.layer))]);
        // 	completionItems.push([...new Set(contractSpecs.filter(item => item.layer.startsWith(layer)).map(item => item.layer))]);

        // 	console.debug(' unique layers: ', completionItems);

        // 	const completionItemList: vscode.CompletionItem[] = completionItems.filter(item => item.startsWith(layer)).map((item, idx) => ({
        // 		label: "/" + item + "/",
        // 		preselect: idx === 0,
        // 		documentation: 'My dedicated VsCode plug-ins provider',
        // 		sortText: `my_completion_${idx}`,
        // 	}));
        // 	return completionItemList;
        // }

        // // 'Verb' auto completion
        // if (text.match(/(.*sub +\/[^/]+\/[^/]*$)|(.*sub +[^/]+$)/)) {
        // 	const taxonomy = text.match(/.*sub +(\/([^/]*)\/)?([^/]*)/);
        // 	let layer = taxonomy[2];
        // 	const verb = taxonomy[3];
        // 	console.debug('layer: ', layer);
        // 	console.debug('verb: ', verb);
        // 	let suggestedLayer = "";

        // 	const defaults = document.getText().match(/^\s*defaults:\s+([^ ,]*)\s*,\s*([^ ,]*)\s*,\s*([^ ,]*)\s*,\s*(\w*)/);
        // 	defLayer = defaults[1];
        // 	defVariation = defaults[2];
        // 	defPlatform = defaults[3];
        // 	defSupplier = defaults[4];

        // 	if (layer != undefined) {
        // 		suggestedLayer = "/" + layer + "/";
        // 	} else {
        // 		suggestedLayer = "";
        // 	}

        // 	if (layer == undefined) { layer = defLayer; }

        // 	const uniqueVerbs = [...new Set(contractSpecs.filter(item => item.layer == layer).filter(item => item.verb.startsWith(verb)).map(item => item.verb))];
        // 	console.debug(' unique verbs: ', uniqueVerbs);

        // 	const completionItemList: vscode.CompletionItem[] = uniqueVerbs.filter(item => item.startsWith(verb)).map((item, idx) => ({
        // 		label: suggestedLayer + item + "/",
        // 		preselect: idx === 0,
        // 		documentation: 'My dedicated VsCode plug-ins provider',
        // 		sortText: `my_completion_${idx}`,
        // 	}));
        // 	console.debug('List: ', completionItemList);
        // 	return completionItemList;
        // }

        // // 'Subject' auto completion
        // if (text.match(/(.*sub +\/[^/]+\/[^/]+\/[^/]*$)|(.*sub +[^/]+\/[^/]*$)/)) {
        // 	const taxonomy = text.match(/.*sub +(\/([^/]*)\/)?([^/]+)\/([^/]*)/);
        // 	let layer = taxonomy[2];
        // 	const verb = taxonomy[3];
        // 	const subject = taxonomy[4];
        // 	console.debug('layer: ', layer);
        // 	console.debug('verb: ', verb);
        // 	console.debug('subject: ', subject);
        // 	let suggestedLayer = "";

        // 	const defaults = document.getText().match(/^\s*defaults:\s+([^ ,]*)\s*,\s*([^ ,]*)\s*,\s*([^ ,]*)\s*,\s*(\w*)/);
        // 	defLayer = defaults[1];
        // 	defVariation = defaults[2];
        // 	defPlatform = defaults[3];
        // 	defSupplier = defaults[4];

        // 	if (layer != undefined) {
        // 		suggestedLayer = "/" + layer + "/";
        // 	} else {
        // 		suggestedLayer = "";
        // 	}

        // 	if (layer == undefined) { layer = defLayer; }

        // 	const uniqueSubjects = [...new Set(contractSpecs
        // 		.filter(item => item.layer == layer)
        // 		.filter(item => item.verb == verb)
        // 		.filter(item => item.subject.startsWith(subject))
        // 		.map(item => item.subject)
        // 	)];

        // 	console.debug(' unique subjects: ', uniqueSubjects);

        // 	const completionItemList: vscode.CompletionItem[] = uniqueSubjects.filter(item => item.startsWith(subject)).map((item, idx) => ({
        // 		label: suggestedLayer + verb + "/" + item,
        // 		preselect: idx === 0,
        // 		documentation: 'My dedicated VsCode plug-ins provider',
        // 		sortText: `my_completion_${idx}`,
        // 	}));
        // 	return completionItemList;
        // }

        // // 'Variation' auto completion
        // if (text.match(/(.*sub +\/[^/]+\/[^/]+\/[^/]+\/[^/]*$)|(.*sub +[^/]+\/[^/]+\/[^/]*$)/)) {
        // 	const taxonomy = text.match(/.*sub +(\/([^/]*)\/)?([^/]+)\/([^/]+)\/([^/]*)/);
        // 	let layer = taxonomy[2];
        // 	const verb = taxonomy[3];
        // 	const subject = taxonomy[4];
        // 	const variation = taxonomy[5];
        // 	console.debug('layer: ', layer);
        // 	console.debug('verb: ', verb);
        // 	console.debug('subject: ', subject);
        // 	console.debug('variation: ', variation);
        // 	let suggestedLayer = "";

        // 	const defaults = document.getText().match(/^\s*defaults:\s+([^ ,]*)\s*,\s*([^ ,]*)\s*,\s*([^ ,]*)\s*,\s*(\w*)/);
        // 	defLayer = defaults[1];
        // 	defVariation = defaults[2];
        // 	defPlatform = defaults[3];
        // 	defSupplier = defaults[4];

        // 	if (layer != undefined) {
        // 		suggestedLayer = "/" + layer + "/";
        // 	} else {
        // 		suggestedLayer = "";
        // 	}

        // 	if (layer == undefined) { layer = defLayer; }

        // 	if (layer == undefined) { layer = defLayer; }
        // 	if (variation == undefined) { layer = defVariation; }

        // 	const uniqueVariations = [...new Set(contractSpecs
        // 		.filter(item => item.layer == layer)
        // 		.filter(item => item.verb == verb)
        // 		.filter(item => item.subject == subject)
        // 		.filter(item => item.variation.startsWith(variation))
        // 		.map(item => item.variation)
        // 	)];

        // 	console.debug(' unique variations: ', uniqueVariations);

        // 	const completionItemList: vscode.CompletionItem[] = uniqueVariations.filter(item => item.startsWith(variation)).map((item, idx) => ({
        // 		label: suggestedLayer + verb + "/" + subject + "/" + item,
        // 		preselect: idx === 0,
        // 		documentation: 'My dedicated VsCode plug-ins provider',
        // 		sortText: `my_completion_${idx}`,
        // 	}));
        // 	return completionItemList;
        // }

        // // 'Platform' auto completion
        // if (text.match(/(.*sub +\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/[^@(]*$)|(.*sub +[^/]+\/[^/]+\/[^/]+\/[^@(]*$)/)) {
        // 	const taxonomy = text.match(/.*sub +(\/([^/]*)\/)?([^/]+)\/([^/]+)\/([^/]+)\/([^@(]*)/);
        // 	let layer = taxonomy[2];
        // 	const verb = taxonomy[3];
        // 	const subject = taxonomy[4];
        // 	const variation = taxonomy[5];
        // 	let platform = taxonomy[6];
        // 	console.debug('layer: ', layer);
        // 	console.debug('verb: ', verb);
        // 	console.debug('subject: ', subject);
        // 	console.debug('variation: ', variation);
        // 	console.debug('platform: ', platform);
        // 	let suggestedLayer = "";
        // 	let suggestedVariation = "";

        // 	const defaults = document.getText().match(/^\s*defaults:\s+([^ ,]*)\s*,\s*([^ ,]*)\s*,\s*([^ ,]*)\s*,\s*(\w*)/);
        // 	defLayer = defaults[1];
        // 	defVariation = defaults[2];
        // 	defPlatform = defaults[3];
        // 	defSupplier = defaults[4];

        // 	if (layer != undefined) {
        // 		suggestedLayer = "/" + layer + "/";
        // 	} else {
        // 		suggestedLayer = "";
        // 	}

        // 	if (layer == undefined) { layer = defLayer; }

        // 	if (variation != undefined) {
        // 		suggestedVariation = variation;
        // 	}

        // 	if (layer == undefined) { layer = defLayer; }
        // 	if (variation == undefined) { layer = defVariation; }
        // 	if (platform == undefined) { platform = defPlatform; }

        // 	const uniquePlatforms = [...new Set(contractSpecs
        // 		.filter(item => item.layer == layer)
        // 		.filter(item => item.verb == verb)
        // 		.filter(item => item.subject == subject)
        // 		.filter(item => item.variation == variation)
        // 		.filter(item => item.platform.startsWith(platform))
        // 		.map(item => item.platform)
        // 	)];

        // 	console.debug(' unique platforms: ', uniquePlatforms);

        // 	const completionItemList: vscode.CompletionItem[] = uniquePlatforms.filter(item => item.startsWith(platform)).map((item, idx) => ({
        // 		label: suggestedLayer + verb + "/" + subject + "/" + variation + "/" + item,
        // 		preselect: idx === 0,
        // 		documentation: 'My dedicated VsCode plug-ins provider',
        // 		sortText: `my_completion_${idx}`,
        // 	}));
        // 	return completionItemList;
        // }

        console.debug("su: ", text);
        return undefined;

        // get all text until the `position` and check if it reads `console.`
        // and if so then complete if `log`, `warn`, and `error`

        // const linePrefix = document.lineAt(position).text.substr(0, position.character);
        // if (!linePrefix.endsWith('sub ')) {
        // 	return undefined;
        // }

        // Use after 'await' function
        // if (token?.isCancellationRequested) return;

        // return [
        // 	new vscode.CompletionItem('log', vscode.CompletionItemKind.Method),
        // 	new vscode.CompletionItem('warn', vscode.CompletionItemKind.Method),
        // 	new vscode.CompletionItem('error', vscode.CompletionItemKind.Method),
        // ];
      },
    }
    // },
    // '.' // triggered whenever a '.' is being typed
  );

  // Code formatting implemented using API
  const emergentDocumentFormattingEditProvider = vscode.languages.registerDocumentFormattingEditProvider(
    "emergent",
    new EmergentDocumentFormatter()
  );
  const emergentDocumentRangeFormattingEditProvider = vscode.languages.registerDocumentRangeFormattingEditProvider(
    "emergent",
    new EmergentDocumentRangeFormatter()
  );

  const emergentHoverProvider = vscode.languages.registerHoverProvider("emergent", {
    async provideHover(document: vscode.TextDocument, position: vscode.Position, token?: vscode.CancellationToken) {
      const defaults = getDefaults(document);

      const textRange = new vscode.Range(new vscode.Position(position.line, 0), new vscode.Position(position.line + 1, 0));
      const text = document.getText(textRange);
      // console.log('T: ', text);

      // const wordRange = document.getWordRangeAtPosition(position, /sub\s+[^(]+/);
      // const word = document.getText(wordRange);

      // If the "word" matches a contract or protocol spec, display the specification.
      // console.log('W: ', word);

      const contract = text.match(
        /.*(sub|job)\s+(?:\/(?<layer>[^/]*)\/?)?(?<verb>[^/]*)?\/?(?<subject>[^/@(]*)?\/?(?<variation>[^/@(]*)?\/?(?<platform>[^/@(]*)?@?(?<supplier>[^(]*)?/
      ).groups;

      if (contract != undefined) {
        // console.log('C: ', contract);
        // Apply defaults
        if (contract.layer == undefined || contract.layer == ".") contract.layer = defaults.layer;
        if (contract.variation == undefined || contract.variation == ".") contract.variation = defaults.variation;
        if (contract.platform == undefined || contract.platform == ".") contract.platform = defaults.platform;
        if (contract.supplier == undefined || contract.supplier == ".") contract.supplier = defaults.supplier;

        if (
          contract.layer == undefined ||
          contract.verb == undefined ||
          contract.variation == undefined ||
          contract.platform == undefined ||
          contract.supplier == undefined
        ) {
          console.log("Failed to parse contract.");
        } else {
          // console.log('F: ', contract);
          return new vscode.Hover(await getContractHoverMarkdown(contract));
        }
      } else {
        console.debug("Failed to classify text:", text);
        return;
      }
    },
  });

  const ecStatusCommandId = "emergent.showFetchError";

  context.subscriptions.push(
    vscode.commands.registerCommand(ecStatusCommandId, () => {
      vscode.window.showInformationMessage(statusInfoMessage());
    })
  );

  // // ###
  // const tokenTypes = ["class", "interface", "enum", "function", "variable"];
  // const tokenModifiers = ["declaration", "documentation"];
  // const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

  // const provider: vscode.DocumentSemanticTokensProvider = {
  //   provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.ProviderResult<vscode.SemanticTokens> {
  //     // analyze the document and return semantic tokens

  //     const tokensBuilder = new vscode.SemanticTokensBuilder(legend);
  //     // on line 1, characters 1-5 are a class declaration
  //     tokensBuilder.push(new vscode.Range(new vscode.Position(1, 1), new vscode.Position(1, 5)), "class", ["declaration"]);
  //     return tokensBuilder.build();
  //   },
  // };

  // const selector = { language: "java", scheme: "file" }; // register for all Java documents from the local file system

  // vscode.languages.registerDocumentSemanticTokensProvider(selector, provider, legend);

  // const emergentDocumentSemanticTokensProvider = vscode.languages.registerDocumentSemanticTokensProvider(selector, provider, legend);
  // context.subscriptions.push(emergentDocumentSemanticTokensProvider);
  // // ###

  ecStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  ecStatusBarItem.command = ecStatusCommandId;
  ecStatusBarItem.show();

  context.subscriptions.push(ecStatusBarItem);
  context.subscriptions.push(contractCompletionProvider, emergentHoverProvider);
  context.subscriptions.push(emergentDocumentFormattingEditProvider);
  context.subscriptions.push(emergentDocumentRangeFormattingEditProvider);

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("gateway")) {
      updateGatewayApiUrl();
      vscode.window.showInformationMessage("Updated");
    }
    if (e.affectsConfiguration("formatting")) {
      updateFormattingCfg();
    }
  });

  // Update Gateway API URL from configuration at start
  updateGatewayApiUrl();

  // Update formatting status from configuration
  updateFormattingCfg();

  // Init Valley state from context.
  try {
    updateStatusBar(ecStatusBarItem, v.init(context), false);
  } catch (error) {
    updateStatusBar(ecStatusBarItem, error.message, false);
  }

  // Start first Valley indexing

  setTimeout(() => {
    updateValleySpecs();
  }, 5000);

  // Schedule future indexing updates
  setInterval(async () => {
    updateValleySpecs();
  }, valleyScanIntervalMs);
}

function updateValleySpecs() {
  v.updateSpecifications()
    .then((status) => {
      updateStatusBar(ecStatusBarItem, status, false);
    })
    .catch((error) => {
      updateStatusBar(ecStatusBarItem, error.message, false);
    });
}

function updateGatewayApiUrl() {
  const gateway = vscode.workspace.getConfiguration("gateway");
  v.setApiRootUrl(gateway.hostname, gateway.port, gateway.allowInsecure);
  console.log("Gateway API URL updated:", v.apiRootUrl);
}

function updateFormattingCfg() {
  const formatting = vscode.workspace.getConfiguration("formatting");
  console.log("Formatting is now", formatting.disabled ? "disabled" : "enabled");
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }

  console.debug("Dectivating 'emergent' language extension.");
  return client.stop();
}

import { connected } from "process";

// const contractSpecs = [
// 	{ layer: "data", verb: "add", subject: "integer", variation: "default", platform: "x64", supplier: "aptissio" },
// 	{ layer: "data", verb: "new", subject: "program", variation: "default", platform: "linux-x64", supplier: "aptissio" },
// 	{ layer: "byte", verb: "new", subject: "integer", variation: "default", platform: "x64", supplier: "aptissio" },
// 	{ layer: "byte", verb: "new", subject: "integer", variation: "default", platform: "x64", supplier: "codevalley" },
// 	{ layer: "byte", verb: "new", subject: "integer", variation: "reserve", platform: "x64", supplier: "aptissio" },
// 	{ layer: "byte", verb: "new", subject: "integer", variation: "reserve", platform: "linux-x64", supplier: "aptissio" },
// 	{ layer: "byte", verb: "new", subject: "integer", variation: "default", platform: "linux-x64", supplier: "codevalley" },
// 	{ layer: "system", verb: "register", subject: "app-flow", variation: "default", platform: "x64", supplier: "codevalley" },
// 	{ layer: "behaviour", verb: "new", subject: "agent-bitcoin-wallet", variation: "default", platform: "linux-x64", supplier: "aptissio" },
// 	{ layer: "data", verb: "new", subject: "bytesequence", variation: "default", platform: "x64", supplier: "codevalley" },
// ];

function updateStatusBar(statusBar: vscode.StatusBarItem, status: string, error = false) {
  if (error) {
    statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  } else {
    statusBar.backgroundColor = undefined;
  }
  // statusBar.text = `$(debug-disconnect) Gateway down`;
  // statusBar.text = `$(pass) Gateway OK`;
  statusBar.text = status;
}

function statusInfoMessage() {
  return statusText;
}
