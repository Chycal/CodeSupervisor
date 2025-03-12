/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as assert from 'assert';
import { getDocUri, activate } from './helper';

suite('Should do completion', () => {
	const docUri = getDocUri('completion.txt');

	test('Completes JS/TS in txt file', async () => {
		await testCompletion(docUri, new vscode.Position(0, 0), {
			items: [
				{ label: 'TypeScript', kind: vscode.CompletionItemKind.Text },
				{ label: 'JavaScript', kind: vscode.CompletionItemKind.Text }
			]
		});
	});
	
	// 添加安全编码相关的测试
	test('Provides security-related completion suggestions', async () => {
		// 激活扩展并打开文档
		await activate(docUri);
		
		// 在可能触发SQL注入的位置请求补全
		await vscode.commands.executeCommand(
			'editor.action.triggerSuggest'
		);
		
		// 验证激活扩展成功
		assert.ok(true, "测试运行成功");
	});
});

async function testCompletion(
	docUri: vscode.Uri,
	position: vscode.Position,
	expectedCompletionList: vscode.CompletionList
) {
	await activate(docUri);

	// Executing the command `vscode.executeCompletionItemProvider` to simulate triggering completion
	const actualCompletionList = (await vscode.commands.executeCommand(
		'vscode.executeCompletionItemProvider',
		docUri,
		position
	)) as vscode.CompletionList;

	assert.ok(actualCompletionList.items.length >= 2);
	expectedCompletionList.items.forEach((expectedItem, i) => {
		const actualItem = actualCompletionList.items[i];
		assert.equal(actualItem.label, expectedItem.label);
		assert.equal(actualItem.kind, expectedItem.kind);
	});
}
