/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as assert from 'assert';
import { activate, doc, getDocUri, setTestContent } from './helper';

suite('Should get diagnostics', () => {
	const docUri = getDocUri('test.dla');

	test('reports parser diagnostics for unterminated strings', async () => {
		await activate(docUri);
		const original = doc.getText();
		const invalidText = [
			'job /example/test(x)',
			'  "unterminated',
			'end'
		].join('\n');

		try {
			await setTestContent(invalidText);
			const diagnostics = await waitForDiagnostics(docUri, (items) =>
				items.some((item) => item.message.toLowerCase().includes('unterminated string'))
			);
			assert.ok(
				diagnostics.some((item) => item.message.toLowerCase().includes('unterminated string')),
				`expected unterminated string diagnostic, got: ${diagnostics.map((d) => d.message).join('; ')}`
			);
		} finally {
			await setTestContent(original);
		}
	});
});

async function waitForDiagnostics(
	docUri: vscode.Uri,
	predicate: (items: readonly vscode.Diagnostic[]) => boolean,
	timeoutMs = 5000
): Promise<readonly vscode.Diagnostic[]> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const diagnostics = vscode.languages.getDiagnostics(docUri);
		if (predicate(diagnostics)) {
			return diagnostics;
		}
		await sleep(100);
	}
	return vscode.languages.getDiagnostics(docUri);
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}
