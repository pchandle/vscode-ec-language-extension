/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as assert from 'assert';
import { getDocUri, activate } from './helper';

suite('Should do completion', () => {
	const docUri = getDocUri('test.dla');

	test('does not offer emergent classification completions after classification is complete', async () => {
		await activate(docUri);
		const document = await vscode.workspace.openTextDocument(docUri);
		const classificationLine = document.lineAt(3).text;
		const cursor = new vscode.Position(3, classificationLine.indexOf('chmod,'));
		const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
			'vscode.executeCompletionItemProvider',
			docUri,
			cursor
		);

		assert.ok(completions, 'expected completion command result');
		const emergentItems = (completions?.items ?? []).filter((item) =>
			typeof item.sortText === 'string' && item.sortText.startsWith('emergent_completion_')
		);
		assert.equal(
			emergentItems.length,
			0,
			`expected no emergent classification completions after classification, got ${emergentItems.map((item) => String(item.label)).join(', ')}`
		);
	});
});
