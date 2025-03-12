/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import * as Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
	// 创建测试模块
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 10000 // 增加超时时间以适应LLM和Ghost Text功能
	});

	const testsRoot = path.resolve(__dirname, '..');

	try {
		// 使用glob的异步API
		const files = await glob('**/**.test.js', { cwd: testsRoot });
		
		console.log('找到的测试文件:', files);

		// 添加文件到测试组件
		files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

		// 运行测试并返回Promise
		return new Promise<void>((resolve, reject) => {
			mocha.run(failures => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		});
	} catch (error) {
		console.error('运行测试时出错:', error);
		throw error;
	}
}