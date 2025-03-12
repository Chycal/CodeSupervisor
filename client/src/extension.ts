/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as path from 'path';
import { 
	workspace, 
	ExtensionContext, 
	window, 
	commands, 
	languages, 
	InlineCompletionItemProvider,
	Uri,
	Range,
	Position,
	TextEditorRevealType,
	MarkdownString,
	StatusBarItem, 
	StatusBarAlignment
} from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
	Trace
} from 'vscode-languageclient/node';

// 导入Ghost Text提供程序
import { GhostTextProvider } from './ghostText';

let client: LanguageClient;

// LLM提供者状态栏
let llmProviderStatusBar: StatusBarItem;

export function activate(context: ExtensionContext) {
	// 添加日志输出
	console.log('安全编码助手扩展已激活');
	
	// The server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);

	// 获取配置
	const config = workspace.getConfiguration('securityAssistant');
	
	// 使用配置中的LLM提供者或默认为deepseek
	const llmProvider = config.get('llmProvider') || 'deepseek';
	console.log(`[客户端] 配置的LLM提供者: ${llmProvider}`);

	// 创建服务器选项
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: { execArgv: ['--nolazy', '--inspect=6009'] }
		}
	};

	// 创建客户端选项
	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: 'file', language: 'javascript' },
			{ scheme: 'file', language: 'typescript' },
			{ scheme: 'file', language: 'python' },
			{ scheme: 'file', language: 'java' },
			{ scheme: 'file', language: 'php' },
			{ scheme: 'file', language: 'ruby' },
			{ scheme: 'file', language: 'plaintext' }
		],
		synchronize: {
			fileEvents: workspace.createFileSystemWatcher('**/*.{js,ts,py,java,php,rb,txt}')
		},
		initializationOptions: {
			settings: {
				securityAssistant: {
					openaiApiKey: config.get('openaiApiKey'),
					deepseekApiKey: config.get('deepseekApiKey'),
					llmProvider: llmProvider,
					customApiBaseUrl: config.get('customApiBaseUrl')
				}
			}
		}
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'securityLanguageServer',
		'Security Language Server',
		serverOptions,
		clientOptions,
		true  // 启用调试输出
	);

	// 配置更详细的日志
	client.setTrace(Trace.Verbose);

	// 添加日志输出
	console.log('正在启动语言服务器...');
	
	// 启动客户端，这同时也会启动服务器
	client.start().then(() => {
		console.log('语言服务器已启动');
		
		// 在客户端启动后注册Ghost Text提供程序
		const ghostTextProvider = new GhostTextProvider(client);
		
		// 注册Ghost Text提供程序
		context.subscriptions.push(
			languages.registerInlineCompletionItemProvider(
				{ pattern: '**/*.{js,ts,py,java,php,rb,txt}' },
				ghostTextProvider as InlineCompletionItemProvider
			)
		);
		
		// 将GhostTextProvider添加到订阅列表，确保dispose被调用
		context.subscriptions.push(ghostTextProvider);
		
		// 注册查看安全建议命令
		context.subscriptions.push(
			commands.registerCommand('security-assistant.showSecurityAdvice', 
				async (uri: Uri, range: Range, message: string) => {
					try {
						// 打开文件并在指定范围显示
						const document = await workspace.openTextDocument(uri);
						const editor = await window.showTextDocument(document);
						editor.revealRange(range, TextEditorRevealType.InCenter);
						
						// 在代码旁边显示安全建议
						window.showInformationMessage(`安全建议: ${message}`);
					} catch (error) {
						console.error('显示安全建议时出错:', error);
						window.showErrorMessage('无法显示安全建议');
					}
				}
			)
		);
		
		// 注册代码分析命令
		context.subscriptions.push(
			commands.registerCommand('security-assistant.analyzeCode',
				async (uri: Uri, range: Range) => {
					try {
						// 获取文档和编辑器
						const document = await workspace.openTextDocument(uri);
						const editor = await window.showTextDocument(document);
						
						// 如果没有提供范围，使用当前选择区域或整个文档
						if (!range) {
							if (editor.selection.isEmpty) {
								range = new Range(
									new Position(0, 0),
									new Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length)
								);
							} else {
								range = editor.selection;
							}
						}
						
						// 显示等待消息
						window.setStatusBarMessage('分析代码安全性...', 3000);
						
						// 发送请求到服务器进行分析
						const response = await client.sendRequest('security-assistant/analyzeCode', {
							textDocument: { uri: document.uri.toString() },
							range: {
								start: { line: range.start.line, character: range.start.character },
								end: { line: range.end.line, character: range.end.character }
							}
						});
						
						// 输出调试信息
						console.log('[安全分析] 收到响应:', response);
						
						// 确保响应是字符串
						const responseText = typeof response === 'string' ? response : JSON.stringify(response);
						
						// 创建markdown内容
						const content = new MarkdownString(responseText);
						content.isTrusted = true;
						
						// 显示分析结果
						const panel = window.createWebviewPanel(
							'securityAnalysis',
							'代码安全分析',
							{ viewColumn: window.activeTextEditor?.viewColumn || 1, preserveFocus: true },
							{ enableScripts: true, enableCommandUris: true }
						);
						
						// 改进HTML渲染方式
						panel.webview.html = `
						<!DOCTYPE html>
						<html lang="zh">
						<head>
							<meta charset="UTF-8">
							<meta name="viewport" content="width=device-width, initial-scale=1.0">
							<title>代码安全分析</title>
							<style>
								body {
									font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
									line-height: 1.6;
									padding: 16px;
									max-width: 800px;
									margin: 0 auto;
								}
								h1 { color: #2c3e50; font-size: 24px; border-bottom: 1px solid #eaecef; padding-bottom: 8px; }
								h2 { color: #3498db; font-size: 20px; margin-top: 24px; }
								h3 { color: #e74c3c; font-size: 18px; }
								pre {
									background-color: #f6f8fa;
									border-radius: 6px;
									padding: 16px;
									overflow: auto;
								}
								code {
									font-family: 'Courier New', Courier, monospace;
								}
								.warning { color: #e74c3c; }
								.info { color: #3498db; }
							</style>
						</head>
						<body>
							<h1>代码安全分析结果</h1>
							<div class="content">
								${responseText
									.replace(/\n\n/g, '</p><p>')
									.replace(/\n/g, '<br>')
									.replace(/#{3} (.*?)$/gm, '<h3>$1</h3>')
									.replace(/#{2} (.*?)$/gm, '<h2>$1</h2>')
									.replace(/#{1} (.*?)$/gm, '<h1>$1</h1>')
									.replace(/`{3}([\s\S]*?)`{3}/g, '<pre><code>$1</code></pre>')
									.replace(/`(.*?)`/g, '<code>$1</code>')}
							</div>
						</body>
						</html>
						`;
					} catch (error) {
						console.error('分析代码时出错:', error);
						window.showErrorMessage('无法分析代码安全性');
					}
				}
			)
		);
		
		// 创建LLM提供者状态栏
		llmProviderStatusBar = window.createStatusBarItem(StatusBarAlignment.Right, 100);
		llmProviderStatusBar.command = 'security-assistant.switchLLMProvider';
		llmProviderStatusBar.tooltip = '切换大模型提供者';
		llmProviderStatusBar.text = '$(hubot) LLM: 加载中...';
		llmProviderStatusBar.show();
		context.subscriptions.push(llmProviderStatusBar);
		
		// 切换LLM提供者命令
		context.subscriptions.push(
			commands.registerCommand('security-assistant.switchLLMProvider', async () => {
				try {
					// 获取可用的提供者
					const providers = await client.sendRequest('security-assistant.getAvailableLLMProviders') as string[];
					if (!providers || providers.length === 0) {
						window.showErrorMessage('没有可用的LLM提供者');
						return;
					}

					// 显示选择菜单
					const selected = await window.showQuickPick(providers, {
						placeHolder: '选择LLM提供者',
						title: '切换大模型提供者',
						canPickMany: false
					});

					if (selected) {
						// 切换提供者
						const result = await client.sendRequest('security-assistant.switchLLMProvider', { provider: selected }) as {
							success: boolean;
							message: string;
						};
						if (result.success) {
							window.showInformationMessage(result.message);
							updateLLMProviderStatus();
						} else {
							window.showErrorMessage(result.message);
						}
					}
				} catch (error) {
					window.showErrorMessage(`切换LLM提供者失败: ${error}`);
				}
			}),

			// 添加自定义LLM提供者命令
			commands.registerCommand('security-assistant.addCustomLLMProvider', async () => {
				try {
					// 获取提供者ID
					const id = await window.showInputBox({
						prompt: '输入提供者ID (仅字母和数字)',
						placeHolder: 'custom-provider',
						validateInput: (value) => {
							return /^[a-zA-Z0-9-_]+$/.test(value) ? null : '提供者ID只能包含字母、数字、连字符和下划线';
						}
					});

					if (!id) {return;}

					// 获取提供者名称
					const name = await window.showInputBox({
						prompt: '输入提供者显示名称',
						placeHolder: '自定义提供者'
					});

					if (!name) {return;}

					// 获取API密钥
					const apiKey = await window.showInputBox({
						prompt: '输入API密钥',
						password: true
					});

					if (!apiKey) {return;}

					// 获取API基础URL
					const baseUrl = await window.showInputBox({
						prompt: '输入API基础URL (可选)',
						placeHolder: 'https://api.example.com/v1'
					});

					// 获取模型名称
					const modelName = await window.showInputBox({
						prompt: '输入模型名称',
						placeHolder: 'gpt-4'
					});

					if (!modelName) {return;}

					// 获取温度值
					const temperatureStr = await window.showInputBox({
						prompt: '输入温度值 (0.0-1.0)',
						placeHolder: '0.1',
						validateInput: (value) => {
							const num = parseFloat(value);
							return (isNaN(num) || num < 0 || num > 1) ? '温度值必须在0到1之间' : null;
						}
					});

					const temperature = temperatureStr ? parseFloat(temperatureStr) : 0.1;

					// 添加自定义提供者
					const config = {
						name,
						apiKey,
						baseUrl: baseUrl || undefined,
						modelName,
						temperature
					};

					const result = await client.sendRequest('security-assistant.addCustomLLMProvider', { id, config }) as {
						success: boolean;
						message: string;
					};
					if (result.success) {
						window.showInformationMessage(`成功添加提供者: ${name}`);
						// 切换到新添加的提供者
						await client.sendRequest('security-assistant.switchLLMProvider', { provider: id });
						updateLLMProviderStatus();
					} else {
						window.showErrorMessage(result.message);
					}
				} catch (error) {
					window.showErrorMessage(`添加自定义LLM提供者失败: ${error}`);
				}
			})
		);
		
		// 更新LLM提供者状态
		updateLLMProviderStatus();
		
		// 显示扩展已激活信息
		window.showInformationMessage('安全编码助手已激活');

		// 导入自定义知识库命令
		context.subscriptions.push(
			commands.registerCommand('security-assistant.importCustomKnowledge', async () => {
				try {
					// 选择知识库文件
					const fileUris = await window.showOpenDialog({
						canSelectMany: true,
						openLabel: '选择知识库文件',
						filters: {
							'文本文件': ['txt', 'md', 'json'],
							'所有文件': ['*']
						}
					});

					if (!fileUris || fileUris.length === 0) {
						return;
					}

					// 显示进度
					await window.withProgress({
						location: { viewId: 'explorer' },
						title: '导入安全知识库',
						cancellable: false
					}, async (progress) => {
						progress.report({ message: '正在读取文件...' });

						const documents = [];
						let processedFiles = 0;

						// 读取所有文件
						for (const uri of fileUris) {
							try {
								const content = await workspace.fs.readFile(uri);
								const text = new TextDecoder().decode(content);
								const fileName = uri.fsPath.split(/[/\\]/).pop() || '';
								
								// 添加到文档列表
								documents.push({
									content: text,
									metadata: {
										source: fileName,
										type: 'security-knowledge',
										timestamp: Date.now()
									}
								});

								processedFiles++;
								progress.report({ 
									message: `已处理 ${processedFiles}/${fileUris.length} 个文件`,
									increment: (100 / fileUris.length)
								});
							} catch (error) {
								console.error(`读取文件失败: ${uri.fsPath}`, error);
							}
						}

						if (documents.length === 0) {
							window.showErrorMessage('没有成功读取任何文件');
							return;
						}

						progress.report({ message: '正在导入知识库...' });

						// 发送到服务器
						const result = await client.sendRequest('security-assistant.importCustomKnowledge', { 
							documents 
						}) as { success: boolean; message: string };

						if (result.success) {
							window.showInformationMessage(result.message);
						} else {
							window.showErrorMessage(result.message);
						}
					});
				} catch (error) {
					window.showErrorMessage(`导入知识库失败: ${error}`);
				}
			})
		);
	});
}

// 更新LLM提供者状态栏
async function updateLLMProviderStatus() {
	try {
		const currentProvider = await client.sendRequest('security-assistant.getCurrentLLMProvider') as {
			name: string;
			modelName: string;
		};
		if (currentProvider) {
			llmProviderStatusBar.text = `$(hubot) LLM: ${currentProvider.name}`;
			llmProviderStatusBar.tooltip = `当前大模型: ${currentProvider.name}\n模型: ${currentProvider.modelName}\n点击切换提供者`;
		} else {
			llmProviderStatusBar.text = '$(hubot) LLM: 未初始化';
			llmProviderStatusBar.tooltip = '大模型未初始化，点击配置';
		}
	} catch (error) {
		llmProviderStatusBar.text = '$(hubot) LLM: 错误';
		llmProviderStatusBar.tooltip = `获取LLM状态失败: ${error}`;
	}
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
