import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import { ChatOpenAI } from '@langchain/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Embeddings } from '@langchain/core/embeddings';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';

// 导入知识库管理模块
import { Document } from './documentModel';
import { knowledgeBase, loadDefaultKnowledgeBase } from './knowledgeBase';
// 导入模型配置
import { getModelConfig, getDefaultModelId, getAvailableModelIds } from './config/modelConfig';

// LLM提供者配置（兼容旧接口）
export interface LLMProviderConfig {
  name: string;
  apiKey: string;
  baseUrl?: string;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  embeddingModel?: string;
  useEmbeddings?: boolean;
}

// LLM模型实例
let llmModel: ChatOpenAI | null = null;
let embeddings: OpenAIEmbeddings | null = null;
let isEmbeddingsInitialized = false;

// 当前使用的模型ID
let currentModelId = getDefaultModelId();

// 导出Document类，用于外部使用
export { Document };

// 设置当前LLM提供者（兼容旧接口）
export function setLLMProvider(modelId: string): boolean {
  const modelConfig = getModelConfig(modelId);
  if (modelConfig) {
    currentModelId = modelId;
    console.log(`[LLM] 已切换到 ${modelConfig.name} 模型`);
    return true;
  }
  console.error(`[LLM] 未找到模型: ${modelId}`);
  return false;
}

// 添加自定义LLM提供者（兼容旧接口）
export function addCustomProvider(_id: string, _config: LLMProviderConfig): boolean {
  console.warn(`[LLM] 添加自定义提供者功能已弃用，请直接修改配置文件`);
  return false;
}

// 获取当前LLM提供者配置（兼容旧接口）
export function getCurrentProviderConfig(): LLMProviderConfig {
  const modelConfig = getModelConfig(currentModelId);
  if (!modelConfig) {
    throw new Error(`未找到模型配置: ${currentModelId}`);
  }
  
  return {
    name: modelConfig.name,
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: modelConfig.baseUrl,
    modelName: modelConfig.modelName,
    temperature: modelConfig.temperature,
    embeddingModel: modelConfig.embeddingModel,
    useEmbeddings: modelConfig.useEmbeddings
  };
}

// 获取所有可用的LLM提供者（兼容旧接口）
export function getAvailableProviders(): string[] {
  return getAvailableModelIds();
}

// 初始化LLM模型
export async function initializeLLM(modelId?: string): Promise<void> {
  try {
    // 如果指定了模型ID，则切换
    if (modelId) {
      if (!setLLMProvider(modelId)) {
        throw new Error(`无效的模型ID: ${modelId}`);
      }
    }
    
    // 获取当前模型配置
    const modelConfig = getModelConfig(currentModelId);
    if (!modelConfig) {
      throw new Error(`未找到模型配置: ${currentModelId}`);
    }
    
    console.log(`[LLM] 正在初始化 ${modelConfig.name} 模型...`);
    
    // 检查API密钥
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API密钥未设置');
    }
    
    // 创建ChatOpenAI实例
    llmModel = new ChatOpenAI({
      temperature: modelConfig.temperature,
      modelName: modelConfig.modelName,
      openAIApiKey: apiKey,
      configuration: {
        baseURL: modelConfig.baseUrl
      }
    });

    // 尝试初始化嵌入功能，但不影响基础LLM功能
    if (modelConfig.useEmbeddings) {
      try {
        console.log(`[LLM] 正在初始化嵌入模型...`);
        
        // 创建Embeddings实例
        // 这里需要用到OpenAI的向量实例，如果使用deepseek会无法初始化
        embeddings = new OpenAIEmbeddings({
          openAIApiKey: apiKey,
          modelName: modelConfig.embeddingModel || 'text-embedding-3-small'
        });

        // 加载默认知识库
        await loadDefaultKnowledgeBase();
        
        // 初始化向量存储
        const success = await knowledgeBase.initVectorStore(embeddings);
        
        isEmbeddingsInitialized = success;
        if (success) {
          console.log(`[LLM] 嵌入模型和向量存储初始化完成`);
        } else {
          console.warn(`[LLM] 向量存储初始化失败，RAG功能将受限`);
        }
      } catch (embeddingError) {
        console.error('[LLM] 嵌入模型初始化失败，RAG功能将不可用:', embeddingError);
        isEmbeddingsInitialized = false;
        embeddings = null;
      }
    } else {
      console.log(`[LLM] 当前模型 ${modelConfig.name} 已禁用嵌入功能`);
      isEmbeddingsInitialized = false;
    }
    
    console.log(`[LLM] ${modelConfig.name} 模型初始化完成`);
    return;
  } catch (error) {
    console.error('[LLM] 初始化失败:', error);
    throw error;
  }
}

// 导入自定义向量数据库
export async function importCustomVectorStore(
  documents: Document[], 
  customEmbeddings?: Embeddings
): Promise<boolean> {
  try {
    console.log('[LLM] 正在导入自定义向量数据库...');
    
    // 如果提供了自定义嵌入模型，则使用它
    const embeddingsToUse = customEmbeddings || embeddings;
    
    if (!embeddingsToUse) {
      console.error('[LLM] 无法导入自定义向量数据库：嵌入模型未初始化');
      return false;
    }
    
    // 添加文档到知识库
    knowledgeBase.addDocuments(documents);
    
    // 初始化向量存储
    const success = await knowledgeBase.initVectorStore(embeddingsToUse);
    isEmbeddingsInitialized = success;
    
    if (success) {
      console.log(`[LLM] 自定义向量数据库导入成功，包含 ${documents.length} 个文档`);
    } else {
      console.error('[LLM] 自定义向量数据库初始化失败');
    }
    
    return success;
  } catch (error) {
    console.error('[LLM] 导入自定义向量数据库失败:', error);
    return false;
  }
}

// 获取安全建议
export async function getSecuritySuggestion(code: string, context: string): Promise<string> {
  if (!llmModel) {
    console.warn('[LLM] LLM未初始化');
    return '无法提供安全建议，LLM服务未初始化';
  }

  try {
    let securityKnowledge = '';
    let relevantDocs: Document[] = [];
    
    // 如果嵌入功能已初始化，则使用RAG
    if (isEmbeddingsInitialized) {
      // 使用RAG获取相关安全知识
      relevantDocs = await knowledgeBase.searchSimilarDocuments(code, 2);
      securityKnowledge = relevantDocs.map(doc => doc.pageContent).join('\n');
      console.log('[LLM] 已从向量存储中检索相关知识');
    } else {
      // 否则使用基础知识
      relevantDocs = knowledgeBase.getDocuments();
      securityKnowledge = relevantDocs.map(doc => doc.pageContent).join('\n');
      console.log('[LLM] 使用基础安全知识（无RAG）');
    }

    // 创建提示模板
    const promptTemplate = PromptTemplate.fromTemplate(`
你是一个专业的代码安全顾问。请分析以下代码片段，并提供安全性改进建议。

代码上下文: {context}

代码片段:
\`\`\`
{code}
\`\`\`

相关安全知识:
{securityKnowledge}

请提供具体的安全改进建议，包括：
1. 发现的潜在安全问题
2. 问题可能导致的安全风险
3. 如何修复这些问题的具体建议
4. 安全最佳实践推荐

回答:
`);

    // 创建LLM处理链
    const chain = RunnableSequence.from([
      promptTemplate,
      llmModel,
      new StringOutputParser()
    ]);

    // 执行处理链
    const response = await chain.invoke({
      code,
      context,
      securityKnowledge
    });

    return response;
  } catch (error) {
    console.error('[LLM] 获取安全建议时出错:', error);
    return '无法获取安全建议，请稍后再试';
  }
}

// 生成代码补全建议
export async function generateCodeCompletion(
  document: TextDocument,
  position: Position
): Promise<CompletionItem[]> {
  if (!llmModel) {
    console.warn('[LLM] LLM未初始化，无法提供代码补全');
    return [];
  }

  try {
    console.log('[LLM] 正在生成代码补全，文档:', document.uri, '位置:', position.line, position.character);
    
    // 获取光标前的文本作为上下文
    const text = document.getText();
    const offset = document.offsetAt(position);
    const prefix = text.substring(0, offset);
    
    // 如果前缀太短，不提供补全
    if (prefix.trim().length < 3) {
      console.log('[LLM] 前缀太短，不提供补全');
      return [];
    }

    // 提取当前行和上下文
    const lines = prefix.split('\n');
    const currentLine = lines[lines.length - 1] || '';
    const contextLines = lines.slice(Math.max(0, lines.length - 10), lines.length - 1);
    const context = contextLines.join('\n');

    console.log('[LLM] 当前行:', currentLine);
    
    // 构建提示
    const promptTemplate = PromptTemplate.fromTemplate(`
你是VSCode的代码补全引擎。基于以下代码上下文，为当前行提供3个最佳的代码补全建议，特别注意确保建议的安全性。

上下文代码:
\`\`\`
{context}
\`\`\`

当前行(|表示光标位置):
\`\`\`
{currentLine}|
\`\`\`

请注意：
1. 提供的补全应该是完整的代码片段，而不仅仅是当前行的剩余部分
2. 确保补全内容在语法和语义上是正确的
3. 优先考虑安全的编码实践
4. 不要重复已经输入的内容
5. 如果是SQL查询，确保使用参数化查询
6. 如果涉及用户输入，确保进行适当的验证和转义

提供3个可能的代码补全，每个一行，不要包含任何解释或markdown格式：
`);

    // 创建LLM处理链
    const chain = RunnableSequence.from([
      promptTemplate,
      llmModel,
      new StringOutputParser()
    ]);

    // 执行处理链
    console.log('[LLM] 发送LLM补全请求');
    const response = await chain.invoke({
      context,
      currentLine
    });
    
    console.log('[LLM] 收到LLM响应:', response);

    // 解析补全项
    const completions = response.split('\n')
      .filter((line: string) => line.trim().length > 0)
      .slice(0, 3)
      .map((completion: string, index: number) => {
        // 检查是否包含常见的安全问题
        const securityIssues = [
          { pattern: /exec\s*\(|eval\s*\(|Function\s*\(/, issue: '可能存在代码注入风险', icon: '⚠️' },
          { pattern: /\.html\s*\(|innerHTML|outerHTML/, issue: 'XSS风险', icon: '🔒' },
          { pattern: /document\.write|document\.writeln/, issue: 'XSS风险', icon: '🔒' },
          { pattern: /SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER/, issue: 'SQL注入风险', icon: '🛡️' },
          { pattern: /password|secret|token|key|credential/, issue: '敏感信息处理', icon: '🔑' },
          { pattern: /http:|https:/, issue: '网络请求安全', icon: '🌐' },
          { pattern: /\.replace\(|\.replaceAll\(/, issue: '字符串替换安全', icon: '📝' },
          { pattern: /\.match\(|\.test\(|\.exec\(/, issue: '正则表达式安全', icon: '🔍' },
          { pattern: /\.parse\(|JSON\.parse/, issue: 'JSON解析安全', icon: '📋' },
          { pattern: /encodeURI|encodeURIComponent|escape/, issue: 'URL编码', icon: '🔗' },
          { pattern: /\.trim\(|\.toLowerCase\(|\.toUpperCase\(/, issue: '字符串处理', icon: '✂️' },
          { pattern: /try\s*{|catch\s*\(/, issue: '错误处理', icon: '🔧' }
        ];
        
        // 检查补全项是否包含安全问题
        let securityDetail = '安全编码建议';
        let securityIcon = '🔰'; // 默认安全图标
        
        for (const { pattern, issue, icon } of securityIssues) {
          if (pattern.test(completion)) {
            securityDetail = `${issue} - 请确保安全处理`;
            securityIcon = icon;
            break;
          }
        }
        
        // 在补全文本前添加图标
        const labelWithIcon = `${securityIcon} ${completion}`;
        
        return {
          label: labelWithIcon,
          kind: CompletionItemKind.Text,
          data: index + 1,
          insertText: completion, // 插入时不包含图标
          detail: securityDetail,
          documentation: `安全编码助手建议: ${completion}\n\n此建议由安全编码助手提供，旨在帮助您编写更安全的代码。`
        };
      });

    console.log('[LLM] 生成补全项:', completions.length);
    return completions;
  } catch (error) {
    console.error('[LLM] 生成代码补全时出错:', error);
    return [];
  }
}

// 分析代码并提供安全改进建议
export async function analyzeCodeSecurity(
  document: TextDocument, 
  range: { 
    start: { line: number; character: number }; 
    end: { line: number; character: number }; 
  }
): Promise<string> {
  if (!llmModel) {
    console.warn('[LLM] LLM未初始化，无法分析代码');
    return '无法分析代码，LLM服务未初始化';
  }

  try {
    console.log('[LLM] 开始分析代码安全性, 文档:', document.uri);
    const text = document.getText(range);
    console.log('[LLM] 分析范围内的代码长度:', text.length);
    
    // 获取文档类型
    const uri = document.uri;
    const fileExtension = uri.split('.').pop()?.toLowerCase() || '';
    let languageType = 'unknown';
    
    if (['js', 'jsx', 'ts', 'tsx'].includes(fileExtension)) {
      languageType = 'javascript/typescript';
    } else if (['py'].includes(fileExtension)) {
      languageType = 'python';
    } else if (['java'].includes(fileExtension)) {
      languageType = 'java';
    } else if (['php'].includes(fileExtension)) {
      languageType = 'php';
    } else if (['rb'].includes(fileExtension)) {
      languageType = 'ruby';
    }
    
    console.log('[LLM] 检测到语言类型:', languageType);

    // 尝试获取相关安全知识
    let securityContext = '';
    if (isEmbeddingsInitialized) {
      try {
        const relevantDocs = await knowledgeBase.searchSimilarDocuments(text, 3);
        securityContext = relevantDocs.map(doc => `- ${doc.pageContent}`).join('\n');
        console.log('[LLM] 已检索相关安全知识用于分析');
      } catch (error) {
        console.warn('[LLM] 检索安全知识失败，将使用通用提示:', error);
      }
    }

    // 创建提示模板
    const promptTemplate = PromptTemplate.fromTemplate(`
你是一个专业的安全代码审计专家。请分析以下{languageType}代码，识别潜在的安全问题，并提供详细的改进建议。

代码:
\`\`\`
{text}
\`\`\`

${securityContext ? `相关安全知识:\n${securityContext}\n` : ''}

请提供以下信息:
1. 安全风险摘要（如果存在）
2. 每个风险的详细说明
3. 具体的修复建议和代码示例
4. 相关的安全最佳实践

回答:
`);

    // 创建LLM处理链
    const chain = RunnableSequence.from([
      promptTemplate,
      llmModel,
      new StringOutputParser()
    ]);

    // 执行处理链
    console.log('[LLM] 发送安全分析请求');
    const analysis = await chain.invoke({
      text,
      languageType
    });
    
    console.log('[LLM] 收到安全分析响应，长度:', analysis.length);
    return analysis;
  } catch (error) {
    console.error('[LLM] 分析代码安全时出错:', error);
    return '无法分析代码，发生错误: ' + error;
  }
} 