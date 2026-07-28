/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { parseE2eTimeout, runVsCodeIntegrationTests } from './e2eLauncher';

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './index');

		const executablePath = await downloadAndUnzipVSCode({});
		await runVsCodeIntegrationTests({
			executablePath,
			extensionDevelopmentPath,
			extensionTestsPath,
			timeoutMs: parseE2eTimeout(process.env.EMERGENT_E2E_TIMEOUT_MS),
		});
	} catch (err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

main();
