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
	StatusBarAlignment,
	Diagnostic,
	DiagnosticCollection
} from 'vscode';

import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
	Trace
} from 'vscode-languageclient/node';
import * as vscode from 'vscode';
import { DiagnosticsHandler, DiagnosticProvider } from "./diagnostics";
import { SecurityIssue } from './types';
// 导入Ghost Text提供程序
import { GhostTextProvider } from './ghostText';
// 导入安全侧边栏提供者
import { SecuritySidebarProvider } from './securitySidebar';
// 导入诊断视图提供者
import { DiagnosticTreeDataProvider, DiagnosticItem } from './diagnosticView';

// 语言服务器
let client: LanguageClient;

// LLM提供者状态栏
let llmProviderStatusBar: StatusBarItem;

// 安全侧边栏提供者
let securitySidebarProvider: SecuritySidebarProvider;

// 诊断树视图提供者
let diagnosticTreeProvider: DiagnosticTreeDataProvider;

// 状态栏消息项
let statusBarMessage: StatusBarItem;

// 是否为调试模式
let isDebugMode = false;

/**
 * 记录日志的帮助函数，仅在调试模式下输出详细日志
 * @param message 日志消息
 * @param forceShow 是否强制显示（即使不在调试模式下）
 */
function log(message: string, forceShow = false): void {
    if (isDebugMode || forceShow) {
        console.log(message);
    }
}

/**
 * 在状态栏显示消息
 * @param message 要显示的消息
 * @param timeout 超时时间（毫秒），0表示不自动隐藏
 */
function updateStatusBarMessage(message: string, timeout = 0): void {
    if (!statusBarMessage) {
        return;
    }
    
    statusBarMessage.text = message;
    statusBarMessage.show();
    
    if (timeout > 0) {
        setTimeout(() => {
            statusBarMessage.hide();
        }, timeout);
    }
}

// 将VSCode诊断转换为SecurityIssue
function convertDiagnosticsToIssues(diagnostics: Map<string, Diagnostic[]>): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    
    diagnostics.forEach((diags, uri) => {
        const fileUri = Uri.parse(uri);
        const fileName = fileUri.fsPath;
        
        // 记录所有诊断的源
        const sources = new Set<string | undefined>();
        diags.forEach(diag => sources.add(diag.source));
        log(`[诊断源] 发现的诊断源: ${Array.from(sources).join(', ')}`);
        
        // 只保留源为security-assistant的诊断
        const filteredDiags = diags.filter(diag => diag.source === 'security-assistant');
        log(`[诊断过滤] 原始诊断数量: ${diags.length}, 过滤后: ${filteredDiags.length}`);
        
        filteredDiags.forEach(diag => {
            // 确定严重性
            let severity: "critical" | "high" | "medium" | "low";
            switch (diag.severity) {
                case vscode.DiagnosticSeverity.Error:
                    severity = 'critical';
                    break;
                case vscode.DiagnosticSeverity.Warning:
                    severity = 'high';
                    break;
                case vscode.DiagnosticSeverity.Information:
                    severity = 'medium';
                    break;
                default:
                    severity = 'low';
                    break;
            }
			
            const ruleId = typeof diag.code === 'object' 
                ? diag.code?.value?.toString() 
                : diag.code?.toString() || 'unknown';
            
            issues.push({
                id: `${uri}:${diag.range.start.line}:${diag.range.start.character}`,
                message: diag.message,
                severity: severity,
                line: diag.range.start.line + 1, // 转为1-based
                column: diag.range.start.character + 1, // 转为1-based
                rule: ruleId,
                filename: fileName,
                source: 'CodeSupervisior' // 统一标记源
            });
        });
    });
    
    log(`[诊断转换] 转换后的SecurityIssue数量: ${issues.length}`);
    return issues;
}

export function activate(context: ExtensionContext) {
	// 添加日志输出
	log('安全编码助手扩展已激活', true);

	// 初始化状态栏消息项
	statusBarMessage = window.createStatusBarItem(StatusBarAlignment.Left, 10);
	context.subscriptions.push(statusBarMessage);
	
	// 读取debug模式配置
	const config = workspace.getConfiguration('securityAssistant');
	isDebugMode = config.get('debugMode') === true;
	log(`[配置] 调试模式: ${isDebugMode}`, true);
	
	// 监听配置变化
	context.subscriptions.push(
		workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('securityAssistant.debugMode')) {
				isDebugMode = config.get('debugMode') === true;
				log(`[配置] 调试模式已更新: ${isDebugMode}`, true);
			}
		})
	);

	// 初始化侧边栏提供者
	securitySidebarProvider = new SecuritySidebarProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			SecuritySidebarProvider.viewType,
			securitySidebarProvider
		)
	);
	
	// 初始化诊断树视图提供者
	diagnosticTreeProvider = new DiagnosticTreeDataProvider();
	const diagnosticsView = vscode.window.createTreeView('security-assistant.diagnostics', {
		treeDataProvider: diagnosticTreeProvider,
		showCollapseAll: true
	});
	context.subscriptions.push(diagnosticsView);
	
	// 初始默认没有诊断
	vscode.commands.executeCommand('setContext', 'security-assistant.hasDiagnostics', false);

	// -----------------------------语言服务器-----------------------
	// #region
	// The server is implemented in node
	const serverModule = context.asAbsolutePath(
		path.join('server', 'out', 'server.js')
	);

	// 使用配置中的LLM提供者或默认为deepseek
	const llmProvider = config.get('llmProvider') || 'deepseek';
	log(`[客户端] 配置的LLM提供者: ${llmProvider}`);

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
	log('正在启动语言服务器...', true);
	
	// 启动客户端，这同时也会启动服务器
	client.start().then(() => {
		log('语言服务器已启动', true);
		
		// 监听诊断变化，更新树视图
		const diagnostics: DiagnosticCollection = languages.createDiagnosticCollection('security-assistant');
		context.subscriptions.push(diagnostics);
		
		// 注册诊断通知处理器
		client.onNotification('security-assistant/publishDiagnostics', (params: { uri: string, diagnostics: Diagnostic[] }) => {
			log(`[诊断更新] 收到诊断通知，URI: ${params.uri}, 诊断数量: ${params.diagnostics.length}`);
			const uri = Uri.parse(params.uri);
			diagnostics.set(uri, params.diagnostics);
			
			// 更新诊断树视图
			const allDiagnostics = new Map<string, Diagnostic[]>();
			
			// 首先添加当前收到的诊断
			if (params.diagnostics.length > 0) {
				allDiagnostics.set(params.uri, [...params.diagnostics]);
			}
			
			// 使用languages.getDiagnostics()获取所有诊断信息
			// 这是VS Code推荐的API
			const allDiagnosticsArr = languages.getDiagnostics();
			log(`[诊断收集] VS Code API返回的诊断总数: ${allDiagnosticsArr.length}`);
			
			for (const [docUri, diags] of allDiagnosticsArr) {
				if (diags && diags.length > 0) {
					log(`[诊断收集] URI: ${docUri.toString()}, 诊断数量: ${diags.length}`);
					// 创建诊断副本，确保数组可变
					allDiagnostics.set(docUri.toString(), [...diags]);
				}
			}
			
			const issues = convertDiagnosticsToIssues(allDiagnostics);
			log(`[诊断转换] 转换后的SecurityIssue数量: ${issues.length}`);
			
			// 更新诊断树视图
			diagnosticTreeProvider.updateIssues(issues);
			
			// 更新状态上下文
			vscode.commands.executeCommand('setContext', 'security-assistant.hasDiagnostics', issues.length > 0);
			
			// 如果有问题但树视图为空，则尝试手动触发更新
			if (issues.length > 0) {
				log('[诊断更新] 发现问题，确保树视图更新');
				// 立即更新诊断树视图，不依赖定时器
				updateDiagnosticTreeView();
			}
			
			// 计算安全评分
			const securityScore = calculateSecurityScore(issues);
			
			// 更新安全仪表盘数据
			if (securitySidebarProvider) {
				log('[诊断更新] 更新安全仪表盘数据');
				securitySidebarProvider.updateIssues(issues, securityScore);
			}
		});
		
		// 注册跳转到问题位置命令
		context.subscriptions.push(
			commands.registerCommand('security-assistant.diagnostics.gotoIssue', (issue: SecurityIssue) => {
				// 打开文件并跳转到问题位置
				vscode.workspace.openTextDocument(issue.filename).then(doc => {
					vscode.window.showTextDocument(doc).then(editor => {
						const position = new vscode.Position(issue.line - 1, issue.column - 1);
						const range = new vscode.Range(position, position);
						editor.selection = new vscode.Selection(position, position);
						editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
					});
				});
			})
		);
		
		// 注册刷新诊断命令
		context.subscriptions.push(
			commands.registerCommand('security-assistant.diagnostics.refresh', () => {
				// 重新验证所有打开的文档
				vscode.workspace.textDocuments.forEach(doc => {
					if (doc.languageId === 'javascript' || 
						doc.languageId === 'typescript' || 
						doc.languageId === 'python' || 
						doc.languageId === 'java' || 
						doc.languageId === 'php' || 
						doc.languageId === 'ruby' || 
						doc.languageId === 'plaintext') {
						client.sendNotification('textDocument/didChange', {
							textDocument: {
								uri: doc.uri.toString(),
								version: doc.version
							},
							contentChanges: [{ text: doc.getText() }]
						});
					}
				});
				
				// 使用手动刷新
				log('[刷新命令] 手动触发诊断树视图更新');
				setTimeout(() => {
					updateDiagnosticTreeView();
				}, 500); // 给服务器一点时间处理
				
				// 使用状态栏显示刷新消息
				updateStatusBarMessage('已刷新诊断信息', 3000);
			})
		);
		
		// 注册清除诊断命令
		context.subscriptions.push(
			commands.registerCommand('security-assistant.diagnostics.clear', () => {
				diagnostics.clear();
				diagnosticTreeProvider.clearIssues();
				vscode.commands.executeCommand('setContext', 'security-assistant.hasDiagnostics', false);
				
				// 使用状态栏显示清除消息
				updateStatusBarMessage('已清除所有诊断问题', 3000);
			})
		);
		
		// 注册修复问题命令
		context.subscriptions.push(
			commands.registerCommand('security-assistant.diagnostics.fixIssue', async (item: DiagnosticItem) => {
				if (!item.issue) {
					return;
				}
				
				// 获取修复建议
				try {
					interface CodeFix {
						edit: {
							range: {
								start: { line: number, character: number },
								end: { line: number, character: number }
							},
							newText: string
						}[];
					}
					
					// 显示正在修复的状态
					updateStatusBarMessage('正在获取修复建议...', 0);
					
					const response = await client.sendRequest('security-assistant/getCodeFix', {
						uri: vscode.Uri.file(item.issue.filename).toString(),
						line: item.issue.line - 1,
						character: item.issue.column - 1
					}) as CodeFix | undefined;
					
					if (response && response.edit) {
						// 应用编辑
						const workspaceEdit = new vscode.WorkspaceEdit();
						const uri = vscode.Uri.file(item.issue.filename);
						
						response.edit.forEach((edit) => {
							const range = new vscode.Range(
								new vscode.Position(edit.range.start.line, edit.range.start.character),
								new vscode.Position(edit.range.end.line, edit.range.end.character)
							);
							workspaceEdit.replace(uri, range, edit.newText);
						});
						
						await vscode.workspace.applyEdit(workspaceEdit);
						updateStatusBarMessage('已修复问题', 3000);
					} else {
						vscode.window.showWarningMessage('无法自动修复此问题');
					}
				} catch (error) {
					console.error('修复问题时出错:', error);
					vscode.window.showErrorMessage(`修复问题失败: ${error}`);
				}
			})
		);
		
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
						
						// 显示进度消息在状态栏
						updateStatusBarMessage('分析代码安全性...', 0);
						
						// 发送请求到服务器进行分析
						const response = await client.sendRequest('security-assistant/analyzeCode', {
							textDocument: { uri: document.uri.toString() },
							range: {
								start: { line: range.start.line, character: range.start.character },
								end: { line: range.end.line, character: range.end.character }
							}
						});
						
						// 输出调试信息
						log('[安全分析] 收到响应:' + (typeof response === 'string' ? response : JSON.stringify(response)));
						
						// 确保响应是字符串
						const responseText = typeof response === 'string' ? response : JSON.stringify(response);
						
						// 创建markdown内容
						const content = new MarkdownString(responseText);
						content.isTrusted = true;
						
						// 在侧边栏中显示分析结果
						securitySidebarProvider.updateIssues([
							{
								id: "analysis-result",
								severity: "medium", // 使用正确的枚举值
								message: responseText,
								filename: document.fileName,
								line: 1,
								column: 1,
								code: "SECURITY_ANALYSIS"
							}
						], 90);
						
						// 更新状态栏消息
						updateStatusBarMessage('安全分析完成', 3000);
						
						// 聚焦到侧边栏视图
						commands.executeCommand('security-assistant.securityDashboard.focus');
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

		// 初始化时自动触发一次工作区分析，确保诊断树视图立即显示
		// 使用setTimeout确保在扩展完全初始化后执行
		setTimeout(() => {
			// 获取当前配置，检查是否需要自动分析
			const config = workspace.getConfiguration('securityAssistant');
			const autoAnalyze = config.get('autoAnalyzeOnStartup') !== false; // 默认启用
			
			console.log(`[自动分析] 配置启用状态: ${autoAnalyze}`);
			
			if (autoAnalyze) {
				if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
					// 分析当前打开的文档，而不是整个工作区，以提高初始化速度
					const openedTextEditors = window.visibleTextEditors;
					console.log(`[自动分析] 找到 ${openedTextEditors.length} 个打开的编辑器`);
					
					if (openedTextEditors.length > 0) {
						// 对当前活动的编辑器进行分析
						for (const editor of openedTextEditors) {
							if (editor && editor.document) {
								console.log(`[自动分析] 分析文档: ${editor.document.uri.toString()}`);
								
								// 仅通过LSP发送通知到语言服务器进行分析
								client.sendNotification('textDocument/didChange', {
									textDocument: {
										uri: editor.document.uri.toString(),
										version: editor.document.version
									},
									contentChanges: [{ text: editor.document.getText() }]
								});
							}
						}
						console.log('[自动分析] 已触发当前打开文档的安全分析');
						
						// 等待服务器处理并安排一次延迟的树视图更新
						setTimeout(() => {
							updateDiagnosticTreeView();
						}, 1500);
					}
				}
			}
		}, 1000);

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
	// #endregion
	// -----------------------------END----------------------------- 

	// ---------------------------提供非LSP的安全检查功能-------------
	// 包括工作区全量检测和单文件全量检测
	// #region
	// 初始化工具
	const diagnosticsHandler = new DiagnosticsHandler();
	const diagnosticProvider = new DiagnosticProvider(diagnosticsHandler);

	// 类型注册
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			["javascript", "typescript", "python", "java", "cpp"],
			diagnosticProvider,
			{
			providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
			}
		)
	);
	// 单文件全量检测功能
	const fullCode = vscode.commands.registerCommand('security-assistant.fullCode',async function () {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage(
			  "CodeSupervisior: 请打开一个文件"
			);
			return;
		}

		if(editor){
			try {
				await vscode.window.withProgress(
				  {
					location: vscode.ProgressLocation.Notification,
					title: "CodeSupervisior: 检测开始，请勿在检测期间更改代码",
					cancellable: false,
				  },
				  async (progress) => {
					progress.report({ increment: 0 });
		
					const document = editor.document;
					// 清除已有分析
					diagnosticsHandler.clearDiagnostics();
		
					// 通过LSP发送到后端进行分析
					progress.report({ increment: 50, message: "正在发送代码到服务器分析..." });

					// 发送请求到服务器进行分析
					client.sendNotification('textDocument/didChange', {
						textDocument: {
							uri: document.uri.toString(),
							version: document.version
						},
						contentChanges: [{ text: document.getText() }]
					});

					try {
						// 额外发送一个全量分析请求
						await client.sendRequest('security-assistant/analyzeFullDocument', {
							textDocument: { uri: document.uri.toString() }
						});
					} catch (error) {
						console.log('[分析] 全量分析请求失败，可能服务器不支持此方法:', error);
						// 发送备用请求
						try {
							await client.sendRequest('security-assistant/analyzeCode', {
								textDocument: { uri: document.uri.toString() },
								range: {
									start: { line: 0, character: 0 },
									end: { line: document.lineCount, character: 0 }
								}
							});
						} catch (err) {
							console.error('[分析] 备用分析请求也失败:', err);
						}
					}
		
					progress.report({ increment: 100, message: "分析完成" });
					
					// 等待一段时间让服务器处理并返回诊断
					await new Promise(resolve => setTimeout(resolve, 1000));
					
					// 使用LSP更新的诊断信息会自动更新诊断树视图
					updateDiagnosticTreeView();
					
					// 确保侧边栏视图可见
					await vscode.commands.executeCommand('security-assistant.securityDashboard.focus');
				  }
				);
			  } catch (error) {
				console.error("分析出错:", error);
				vscode.window.showErrorMessage(
				  `CodeSupervisior: - ${
					error instanceof Error ? error.message : "未知错误"
				  }`
				);
			  }
		}
	});
	// 工作区文件全量检测
	const workspace_fullcode = vscode.commands.registerCommand('security-assistant.workSpaceFullCode',async function () {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		const workspaceURI = vscode.workspace.workspaceFile;
		if (!workspaceFolders) {
			vscode.window.showWarningMessage(
			"CodeSupervisior: 请打开一个工作区"
			);
			return;
		}
		if(!workspaceURI){
			vscode.window.showWarningMessage(
			"CodeSupervisior: 请打开一个工作区"
			);
			return;
		}
		try {
			await vscode.window.withProgress(
			{
			location: vscode.ProgressLocation.Notification,
			title: "CodeSupervisior: 检测开始，请勿在检测期间更改代码",
			cancellable: true,
			},
			async (progress, _token) => {
				progress.report({ message: "正在准备分析..." });
				
				// 清除已有诊断
				diagnosticsHandler.clearDiagnostics();
				
				// 发送请求到服务器，执行工作区全量分析
				progress.report({ message: "正在向服务器发送工作区分析请求..." });
				
				try {
					// 通过LSP发送工作区分析请求
					await client.sendRequest('security-assistant/analyzeWorkspace', {
						workspaceFolders: workspaceFolders.map(folder => folder.uri.toString())
					});
				} catch (error) {
					console.error("工作区分析请求错误:", error);
					vscode.window.showInformationMessage('工作区分析功能需要服务器支持，正在尝试替代方案...');
					
					// 如果工作区分析失败，尝试逐个文件分析
					try {
						// 查找所有支持的文件
						const files = await vscode.workspace.findFiles(
							"{**/*.js,**/*.ts,**/*.py,**/*.java,**/*.cpp}",
							"{**/node_modules/**,**/dist/**,**/build/**,**/.git/**}"
						);
						
						progress.report({ message: `找到 ${files.length} 个文件，逐个分析中...` });
						
						// 逐个文件发送分析请求
						let processedFiles = 0;
						for (const file of files) {
							try {
								const document = await vscode.workspace.openTextDocument(file);
								client.sendNotification('textDocument/didChange', {
									textDocument: {
										uri: document.uri.toString(),
										version: document.version
									},
									contentChanges: [{ text: document.getText() }]
								});
								
								// 尝试使用analyzeCode方法
								await client.sendRequest('security-assistant/analyzeCode', {
									textDocument: { uri: document.uri.toString() },
									range: {
										start: { line: 0, character: 0 },
										end: { line: document.lineCount, character: 0 }
									}
								});
								
								processedFiles++;
								progress.report({ 
									message: `已分析 ${processedFiles}/${files.length} 个文件...`
								});
							} catch (err) {
								console.error(`分析文件失败 ${file.fsPath}:`, err);
							}
						}
					} catch (err) {
						console.error("替代方案也失败:", err);
						vscode.window.showErrorMessage("无法分析工作区文件");
					}
				}
				
				// 等待分析完成
				progress.report({ message: "等待服务器分析完成..." });
				await new Promise(resolve => setTimeout(resolve, 2000));
				
				// 更新诊断视图
				updateDiagnosticTreeView();
				
				// 确保侧边栏视图可见
				await vscode.commands.executeCommand('security-assistant.securityDashboard.focus');
			});
		} catch (error) {
			console.error("工作区分析错误:", error);
			vscode.window.showErrorMessage(
				`CodeSupervisior: 工作区分析失败 - ${
				error instanceof Error ? error.message : "未知错误"
				}`
			);
		}
	});
	// 注册
	context.subscriptions.push(fullCode);
	context.subscriptions.push(workspace_fullcode);
	//#endregion
	// -----------------------------END------------------------------

	// 替换为：在文件变化时更新诊断
	// 监听文件变更事件，仅在文件变化时更新诊断
	const fileWatcher = workspace.createFileSystemWatcher('**/*.{js,ts,py,java,php,rb,txt}');
	context.subscriptions.push(
		fileWatcher.onDidChange((uri) => {
			log(`[文件变更] 检测到文件变更: ${uri.toString()}`);
			// 延迟更新，避免频繁触发
			setTimeout(() => updateDiagnosticTreeView(), 1000);
		})
	);
	// 确保在扩展停用时清除文件监听器
	context.subscriptions.push(fileWatcher);
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

// 辅助函数：统一更新诊断树视图
function updateDiagnosticTreeView() {
	try {
		// 获取所有诊断
		const allDiagnostics = new Map<string, Diagnostic[]>();
		const allDiagnosticsArr = languages.getDiagnostics();
		
		log(`[诊断视图更新] VS Code API返回诊断数组长度: ${allDiagnosticsArr.length}`);
		
		// 记录有多少文件包含诊断
		let filesWithDiagnostics = 0;
		let totalDiagnosticCount = 0;
		
		for (const [docUri, diags] of allDiagnosticsArr) {
			if (diags && diags.length > 0) {
				log(`[诊断视图更新] 文件 ${docUri.toString()} 有 ${diags.length} 个诊断`);
				filesWithDiagnostics++;
				totalDiagnosticCount += diags.length;
				
				allDiagnostics.set(docUri.toString(), [...diags]);
			}
		}
		
		log(`[诊断视图更新] 总计: ${filesWithDiagnostics} 个文件有诊断，共 ${totalDiagnosticCount} 个诊断项`);
		
		// 转换并更新
		const issues = convertDiagnosticsToIssues(allDiagnostics);
		log(`[诊断树视图更新] 找到 ${issues.length} 个安全问题`);
		
		// 更新诊断树视图
		diagnosticTreeProvider.updateIssues(issues);
		vscode.commands.executeCommand('setContext', 'security-assistant.hasDiagnostics', issues.length > 0);
		
		// 如果有安全问题，在状态栏显示
		if (issues.length > 0) {
			updateStatusBarMessage(`发现 ${issues.length} 个安全问题`, 5000);
		}
		
		// 计算安全评分 - 基于问题的严重性和数量
		const securityScore = calculateSecurityScore(issues);
		log(`[安全评分] 计算得分: ${securityScore}, 基于 ${issues.length} 个问题`);
		
		// 更新安全仪表盘
		if (securitySidebarProvider) {
			// 确保同步更新安全仪表盘
			securitySidebarProvider.updateIssues(issues, securityScore);
			log(`[安全仪表盘] 已更新问题数据和评分`);
		} else {
			log(`[安全仪表盘] 提供者未初始化，无法更新`);
		}
	} catch (error) {
		console.error('[诊断更新] 更新诊断视图时出错:', error);
	}
}

/**
 * 计算安全评分
 * 根据问题的严重性和数量计算一个0-100的分数
 */
function calculateSecurityScore(issues: SecurityIssue[]): number {
	if (issues.length === 0) {
		return 100; // 没有问题则满分
	}
	
	// 各个级别问题的权重
	const weights = {
		critical: 10,
		high: 5,
		medium: 2,
		low: 1
	};
	
	// 计算减分总和
	let deduction = 0;
	issues.forEach(issue => {
		deduction += weights[issue.severity] || 0;
	});
	
	// 将减分限制在0-100范围内，确保分数不会为负
	deduction = Math.min(deduction, 100);
	
	// 返回最终分数
	return Math.max(0, 100 - deduction);
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
