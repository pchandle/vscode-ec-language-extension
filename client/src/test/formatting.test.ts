import * as vscode from 'vscode';
import * as assert from 'assert';
import { activate, doc, getDocUri, setTestContent } from './helper';

suite('Should format emergent documents', () => {
	const docUri = getDocUri('test.dla');

	test('normalizes commas, arrows, and extra spacing', async () => {
		await activate(docUri);
		const original = doc.getText();
		const unformatted = [
			'job /example/test(a,b)->out',
			'  value1  ,value2  ->out2  ',
			'// keep   comment spacing',
			'end'
		].join('\n');

		try {
			await setTestContent(unformatted);
			const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
				'vscode.executeFormatDocumentProvider',
				docUri,
				{ tabSize: 2, insertSpaces: true }
			);

			assert.ok(Array.isArray(edits), 'expected formatter to return edits');
			assert.ok((edits ?? []).length > 0, 'expected at least one formatting edit');

			const workspaceEdit = new vscode.WorkspaceEdit();
			workspaceEdit.set(docUri, edits ?? []);
			await vscode.workspace.applyEdit(workspaceEdit);

			const formatted = doc.getText().replace(/\r\n/g, '\n');
				const expected = [
					'job /example/test(a, b) -> out',
					'  value1, value2 -> out2',
				'// keep   comment spacing',
				'end'
			].join('\n');
			assert.equal(formatted, expected);
		} finally {
			await setTestContent(original);
		}
	});
});
