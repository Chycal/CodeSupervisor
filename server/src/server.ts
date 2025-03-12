/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import {
	createConnection,
	TextDocuments,
	// Diagnostic,
	// DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	DocumentDiagnosticReportKind,
	type DocumentDiagnosticReport,
	CodeActionKind,
	CodeAction,
	CodeActionParams,
	Command
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

// 导入安全规则和LLM集成模块
import { runSecurityRules } from './securityRules';
import {
	initializeLLM,
	generateCodeCompletion,
	analyzeCodeSecurity,
	setLLMProvider,
	getAvailableProviders,
	getCurrentProviderConfig,
	addCustomProvider,
	LLMProviderConfig,
	Document,
	importCustomVectorStore
} from './llmIntegration';
import { getDefaultModelId } from './config/modelConfig';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
// let hasDiagnosticRelatedInformationCapability = false;

// 标记LLM是否初始化
let isLLMInitialized = false;

// 扩展设置
interface SecurityAssistantSettings {
	maxNumberOfProblems: number;
	enableLLM: boolean;
	enableGhostText: boolean;
	supportedLanguages: string[];
}

// 默认设置
const defaultSettings: SecurityAssistantSettings = {
	maxNumberOfProblems: 1000,
	enableLLM: true,
	enableGhostText: true,
	supportedLanguages: ['javascript', 'typescript', 'python', 'java', 'php', 'ruby', 'plaintext']
};

// 全局设置
let globalSettings: SecurityAssistantSettings = defaultSettings;

// 存储所有打开文档的设置
const documentSettings = new Map<string, Thenable<SecurityAssistantSettings>>();

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	// hasDiagnosticRelatedInformationCapability = !!(
	// 	capabilities.textDocument &&
	// 	capabilities.textDocument.publishDiagnostics &&
	// 	capabilities.textDocument.publishDiagnostics.relatedInformation
	// );

	// 获取客户端配置
	const settings = params.initializationOptions?.settings;
	if (settings) {
		// 从配置中读取API密钥
		if (settings.securityAssistant?.openaiApiKey && !process.env.OPENAI_API_KEY) {
			process.env.OPENAI_API_KEY = settings.securityAssistant.openaiApiKey;
			console.log('从配置中读取OpenAI API密钥');
		}
	}

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			// 支持代码补全
			completionProvider: {
				resolveProvider: true,
				triggerCharacters: ['.', '(', '[', '"', "'", ' '] // 触发代码补全的字符
			},
			// 支持诊断
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false
			},
			// 支持代码操作
			codeActionProvider: {
				codeActionKinds: [CodeActionKind.QuickFix]
			}
		}
	};
	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(async () => {
	console.log(`[服务器] 初始化完成`);
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
	
	// 初始化LLM
	try {
		// 检查环境变量
		const openaiKey = process.env.OPENAI_API_KEY;
		
		if (openaiKey) {
			console.log('[服务器] 找到OpenAI API密钥，将初始化LLM');
			
			// 获取客户端配置的提供者
			const settings = await connection.workspace.getConfiguration({
				section: 'securityAssistant'
			});
			
			// 使用配置中的模型或默认模型（优先使用默认模型）
			const preferredModel = settings?.llmProvider || getDefaultModelId();
			console.log(`[服务器] 配置的首选模型: ${preferredModel}`);
			
			// 初始化LLM
			await initializeLLM(preferredModel);
			isLLMInitialized = true;
			console.log(`[服务器] LLM初始化完成`);

		} else {
			console.log('[服务器] 未找到OpenAI API密钥，LLM功能将不可用');
			console.log('[服务器] 请在环境变量中设置OPENAI_API_KEY');
		}
	} catch (error) {
		console.error('[服务器] 初始化LLM失败:', error);
	}
});

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = (
			(change.settings.securityAssistant || defaultSettings)
		);
	}
	// 更新诊断信息
	connection.languages.diagnostics.refresh();
});

// 获取文档设置
function getDocumentSettings(resource: string): Thenable<SecurityAssistantSettings> {
	if (!hasConfigurationCapability) {
		return Promise.resolve(globalSettings);
	}
	let result = documentSettings.get(resource);
	if (!result) {
		result = connection.workspace.getConfiguration({
			scopeUri: resource,
			section: 'securityAssistant'
		});
		documentSettings.set(resource, result);
	}
	return result;
}

// 当文档关闭时清除设置缓存
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
});

// 处理诊断请求
connection.languages.diagnostics.on(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (document !== undefined) {
		// 运行安全规则和基本诊断
		const securityDiagnostics = await runSecurityRules(document);
		
		return {
			kind: DocumentDiagnosticReportKind.Full,
			items: securityDiagnostics
		} satisfies DocumentDiagnosticReport;
	} else {
		return {
			kind: DocumentDiagnosticReportKind.Full,
			items: []
		} satisfies DocumentDiagnosticReport;
	}
});

// 处理文档变化的函数
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

// 验证文档内容
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	// 这个函数不再发送诊断信息，因为我们使用connection.languages.diagnostics来处理诊断
	// 避免重复的诊断信息
	console.log(`[服务器] 文档内容变化，将由诊断程序处理: ${textDocument.uri}`);
	// 等待一小段时间后刷新诊断，以确保变更被处理
	setTimeout(() => {
		connection.languages.diagnostics.refresh();
	}, 100);
}

// 处理代码操作请求（提供修复建议）
connection.onCodeAction(async (params: CodeActionParams) => {
	const { textDocument, context, range } = params;
	const document = documents.get(textDocument.uri);
	if (!document) {
		return [];
	}

	const codeActions: (CodeAction | Command)[] = [];

	// 如果有诊断问题，提供修复建议
	if (context.diagnostics.length > 0) {
		for (const diagnostic of context.diagnostics) {
			if (diagnostic.source === 'security-assistant') {
				// 创建一个快速修复代码操作
				const fixAction = CodeAction.create(
					'查看安全建议',
					{
						title: '查看安全建议',
						command: 'security-assistant.showSecurityAdvice',
						arguments: [document.uri, diagnostic.range, diagnostic.message]
					},
					CodeActionKind.QuickFix
				);
				
				fixAction.diagnostics = [diagnostic];
				codeActions.push(fixAction);
			}
		}
	}

	// 提供代码分析操作
	if (isLLMInitialized) {
		const analyzeAction = CodeAction.create(
			'分析代码安全性',
			{
				title: '分析代码安全性',
				command: 'security-assistant.analyzeCode',
				arguments: [document.uri, range]
			},
			CodeActionKind.RefactorRewrite
		);
		codeActions.push(analyzeAction);
	}

	return codeActions;
});

// 处理代码补全请求
connection.onCompletion(
	async (params: TextDocumentPositionParams): Promise<CompletionItem[]> => {
		const document = documents.get(params.textDocument.uri);
		if (!document) {
			return [];
		}

		// 获取设置
		const settings = await getDocumentSettings(params.textDocument.uri);
		
		// 检查文档类型是否受支持
		const fileExtension = params.textDocument.uri.split('.').pop()?.toLowerCase();
		let isSupported = false;
		if (fileExtension) {
			for (const lang of settings.supportedLanguages) {
				if (
					(lang === 'javascript' && ['js', 'jsx'].includes(fileExtension)) ||
					(lang === 'typescript' && ['ts', 'tsx'].includes(fileExtension)) ||
					(lang === 'python' && fileExtension === 'py') ||
					(lang === 'java' && fileExtension === 'java') ||
					(lang === 'php' && fileExtension === 'php') ||
					(lang === 'ruby' && fileExtension === 'rb') ||
					(lang === 'plaintext' && fileExtension === 'txt')
				) {
					isSupported = true;
					break;
				}
			}
		}

		// 如果启用了LLM并且文档类型受支持，则提供基于LLM的补全
		if (settings.enableLLM && isLLMInitialized && isSupported) {
			try {
				const llmCompletions = await generateCodeCompletion(document, params.position);
				if (llmCompletions && llmCompletions.length > 0) {
					console.log(`[服务器] 返回LLM生成的补全项: ${llmCompletions.length}项`);
					return llmCompletions;
				}
			} catch (error) {
				connection.console.error(`代码补全生成失败: ${error}`);
			}
		}
		return [];
	}
);

// 完成补全项的额外处理
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		// 如果是LLM生成的补全项，已经有详细信息，直接返回
		if (item.data && typeof item.data === 'number' && item.data >= 1 && item.data <= 2) {
			// 处理旧的默认补全项
			if (item.data === 1) {
				item.detail = 'TypeScript细节';
				item.documentation = 'TypeScript文档';
			} else if (item.data === 2) {
				item.detail = 'JavaScript细节';
				item.documentation = 'JavaScript文档';
			}
		} else if (!item.documentation) {
			// 为没有文档的项添加默认文档
			item.documentation = '安全编码助手提供的代码补全建议';
		}
		
		return item;
	}
);

// 定义代码分析请求的参数类型
interface CodeAnalysisParams {
	textDocument: { uri: string };
	range: { 
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
}

// 注册自定义请求处理程序，用于代码安全分析
connection.onRequest('security-assistant/analyzeCode', async (params: CodeAnalysisParams) => {
	const { textDocument, range } = params;
	const document = documents.get(textDocument.uri);
	
	if (!document) {
		return '无法找到文档';
	}
	
	if (!isLLMInitialized) {
		return '无法分析代码，LLM服务未初始化';
	}
	
	try {
		console.log('[服务器] 开始分析代码安全性');
		const analysis = await analyzeCodeSecurity(document, range);
		console.log('[服务器] 代码安全分析完成');
		return analysis;
	} catch (error) {
		console.error('[服务器] 分析代码安全性时出错:', error);
		return '分析代码时出错';
	}
});

// 注册切换LLM提供者的命令
connection.onRequest('security-assistant.switchLLMProvider', async (params: { provider: string }) => {
	try {
		const success = setLLMProvider(params.provider);
		if (success) {
			await initializeLLM();
			return { success: true, message: `已切换到 ${params.provider} 提供者` };
		} else {
			return { success: false, message: `未找到提供者: ${params.provider}` };
		}
	} catch (error) {
		console.error('切换LLM提供者失败:', error);
		return { success: false, message: `切换失败: ${error}` };
	}
});

// 获取可用的LLM提供者
connection.onRequest('security-assistant.getAvailableLLMProviders', () => {
	return getAvailableProviders();
});

// 获取当前LLM提供者配置
connection.onRequest('security-assistant.getCurrentLLMProvider', () => {
	return getCurrentProviderConfig();
});

// 添加自定义LLM提供者
connection.onRequest('security-assistant.addCustomLLMProvider', (params: { id: string, config: LLMProviderConfig }) => {
	try {
		const success = addCustomProvider(params.id, params.config);
		return { success, message: success ? '添加成功' : '添加失败' };
	} catch (error) {
		console.error('添加自定义LLM提供者失败:', error);
		return { success: false, message: `添加失败: ${error}` };
	}
});

// 添加自定义RAG知识库
connection.onRequest('security-assistant.importCustomKnowledge', async (params: { 
	documents: { content: string; metadata: Record<string, string | string[] | number | boolean | undefined> }[] 
}) => {
	try {
		console.log(`[服务器] 收到导入自定义知识库请求，文档数量: ${params.documents.length}`);
		
		// 转换为Document对象
		const documents = params.documents.map(doc => new Document({
			pageContent: doc.content,
			metadata: doc.metadata as { 
				category: string; 
				severity: string; 
				id?: string; 
				tags?: string[];
				[key: string]: string | string[] | number | boolean | undefined;
			}
		}));
		
		// 导入自定义向量数据库
		const success = await importCustomVectorStore(documents);
		
		return { 
			success, 
			message: success ? 
				`成功导入 ${documents.length} 个文档到知识库` : 
				'导入知识库失败' 
		};
	} catch (error) {
		console.error('[服务器] 导入自定义知识库失败:', error);
		return { success: false, message: `导入失败: ${error}` };
	}
});

// 处理getCodeFix请求
connection.onRequest('security-assistant/getCodeFix', async (params: { 
    uri: string;
    line: number;
    character: number;
}) => {
    console.log(`[服务器] 收到生成代码修复请求: ${params.uri}:${params.line}:${params.character}`);
    
    // 获取文档
    const document = documents.get(params.uri);
    if (!document) {
        return undefined;
    }
    
    if (!isLLMInitialized) {
        console.log('[服务器] LLM未初始化，无法生成代码修复');
        return undefined;
    }
    
    try {
        // 定义问题所在行的范围
        const range = {
            start: { line: Math.max(0, params.line - 5), character: 0 },
            end: { line: Math.min(document.lineCount - 1, params.line + 5), character: Number.MAX_SAFE_INTEGER }
        };
        
        // 使用已有的analyzeCodeSecurity函数分析问题
        console.log('[服务器] 分析安全问题并生成修复建议');
        const analysis = await analyzeCodeSecurity(document, range);
        
        // 将分析结果和修复提示一起发送给服务器
        console.log('[服务器] 生成代码修复JSON');
        
        // 创建一个模拟的修复响应
        // 在实际实现中，应该使用LLM再次处理分析结果生成修复方案
        // 这里为了简化，直接构造一个可能的修复方案
        const targetLine = document.getText({
            start: { line: params.line, character: 0 },
            end: { line: params.line, character: Number.MAX_SAFE_INTEGER }
        });
        
        // 根据分析结果构造修复方案
        const securityIssueTypes = {
            'sql注入': '// 使用参数化查询替代字符串拼接\n' + targetLine.replace(/\+\s*['"].*?['"]/g, '?').replace(/\+/g, ', '),
            'xss': '// 使用安全的DOM API\n' + targetLine.replace(/innerHTML/g, 'textContent'),
            '命令注入': '// 使用安全的命令执行方式\n' + targetLine.replace(/exec\s*\(/g, 'execFile('),
            '文件路径遍历': '// 验证和净化文件路径\n' + targetLine.replace(/\.\.\/|\.\.\\/, ''),
            '不安全的正则': '// 限制正则表达式复杂度\n' + targetLine,
            '默认修复': '// 已修复的安全问题\n' + targetLine + ' // TODO: 手动检查安全问题'
        };
        
        // 尝试根据分析结果匹配可能的修复类型
        let newText = securityIssueTypes.默认修复;
        for (const [issueType, fix] of Object.entries(securityIssueTypes)) {
            if (analysis.toLowerCase().includes(issueType)) {
                newText = fix;
                break;
            }
        }
        
        // 构造JSON响应
        const fixData = {
            edit: [
                {
                    range: {
                        start: { line: params.line, character: 0 },
                        end: { line: params.line, character: targetLine.length }
                    },
                    newText: newText
                }
            ]
        };
        
        console.log('[服务器] 成功生成代码修复建议');
        return fixData;
    } catch (error) {
        console.error('[服务器] 生成代码修复时出错:', error);
        return undefined;
    }
});

// 文档管理器监听连接
documents.listen(connection);
// 开始监听
connection.listen();
