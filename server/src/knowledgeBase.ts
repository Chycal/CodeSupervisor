import * as fs from 'fs';
import * as path from 'path';
import { Document, DocumentMetadata } from './documentModel';
import { Embeddings } from '@langchain/core/embeddings';
import { HNSWLib } from '@langchain/community/vectorstores/hnswlib';

// 知识库管理类
export class KnowledgeBase {
  private documents: Document[] = [];
  private vectorStore: HNSWLib | null = null;
  private isInitialized = false;

  // 从JSON文件加载知识库
  async loadFromFile(filePath: string): Promise<Document[]> {
    try {
      const absolutePath = path.resolve(__dirname, filePath);
      console.log(`[知识库] 正在从文件加载知识库: ${absolutePath}`);
      
      const fileContent = fs.readFileSync(absolutePath, 'utf-8');
      const jsonData = JSON.parse(fileContent);
      
      this.documents = jsonData.map((item: {
        pageContent: string;
        metadata: {
          category: string;
          severity: string;
          id?: string;
          tags?: string[];
          [key: string]: string | string[] | number | boolean | undefined;
        }
      }) => new Document({
        pageContent: item.pageContent,
        metadata: item.metadata
      }));
      
      console.log(`[知识库] 成功加载 ${this.documents.length} 个文档`);
      return this.documents;
    } catch (error) {
      console.error('[知识库] 加载知识库文件失败:', error);
      // 返回空数组而不是抛出异常，以便程序可以继续运行
      return [];
    }
  }

  // 获取所有文档
  getDocuments(): Document[] {
    return this.documents;
  }

  // 添加文档
  addDocuments(newDocuments: Document[]): void {
    this.documents = [...this.documents, ...newDocuments];
    this.isInitialized = false; // 重置初始化状态，需要重新创建向量存储
  }

  // 清空文档
  clearDocuments(): void {
    this.documents = [];
    this.isInitialized = false;
  }

  // 按类别获取文档
  getDocumentsByCategory(category: string): Document[] {
    return this.documents.filter(doc => 
      doc.metadata.category === category
    );
  }

  // 按严重性获取文档
  getDocumentsBySeverity(severity: string): Document[] {
    return this.documents.filter(doc => 
      doc.metadata.severity === severity
    );
  }

  // 按标签获取文档
  getDocumentsByTag(tag: string): Document[] {
    return this.documents.filter(doc => 
      doc.metadata.tags && Array.isArray(doc.metadata.tags) && 
      doc.metadata.tags.includes(tag)
    );
  }

  // 初始化向量存储
  async initVectorStore(embeddings: Embeddings): Promise<boolean> {
    try {
      if (this.documents.length === 0) {
        console.warn('[知识库] 没有文档可以初始化向量存储');
        return false;
      }

      console.log('[知识库] 正在初始化向量存储...');
      this.vectorStore = await HNSWLib.fromDocuments(this.documents, embeddings);
      this.isInitialized = true;
      console.log('[知识库] 向量存储初始化完成');
      return true;
    } catch (error) {
      console.error('[知识库] 初始化向量存储失败:', error);
      this.isInitialized = false;
      return false;
    }
  }

  // 搜索相关文档
  async searchSimilarDocuments(query: string, k = 2): Promise<Document[]> {
    if (!this.isInitialized || !this.vectorStore) {
      console.warn('[知识库] 向量存储未初始化，无法搜索');
      // 如果向量存储未初始化，返回基于关键词的简单匹配
      return this.simpleKeywordSearch(query, k);
    }

    try {
      console.log(`[知识库] 正在搜索相关文档: "${query}"`);
      const results = await this.vectorStore.similaritySearch(query, k);
      // 将结果转换为 Document 类型
      return results.map(doc => new Document({
        pageContent: doc.pageContent,
        metadata: doc.metadata as DocumentMetadata
      }));
    } catch (error) {
      console.error('[知识库] 搜索相关文档失败:', error);
      // 如果向量搜索失败，回退到简单关键词搜索
      return this.simpleKeywordSearch(query, k);
    }
  }

  // 简单的关键词搜索（作为向量搜索的备选方案）
  private simpleKeywordSearch(query: string, k = 2): Document[] {
    console.log('[知识库] 使用关键词搜索作为备选方案');
    const keywords = query.toLowerCase().split(/\s+/);
    
    // 为每个文档计算匹配分数
    const scoredDocs = this.documents.map(doc => {
      const content = doc.pageContent.toLowerCase();
      let score = 0;
      
      // 计算关键词匹配次数
      keywords.forEach(keyword => {
        if (content.includes(keyword)) {
          score += 1;
        }
      });
      
      // 考虑元数据中的类别和标签
      if (doc.metadata.category && query.toLowerCase().includes(doc.metadata.category.toLowerCase())) {
        score += 2;
      }
      
      if (doc.metadata.tags && Array.isArray(doc.metadata.tags)) {
        doc.metadata.tags.forEach(tag => {
          if (query.toLowerCase().includes(tag.toLowerCase())) {
            score += 1;
          }
        });
      }
      
      return { doc, score };
    });
    
    // 按分数排序并返回前k个文档
    return scoredDocs
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(item => item.doc);
  }

  // 获取初始化状态
  isVectorStoreInitialized(): boolean {
    return this.isInitialized;
  }
}

// 创建并导出单例实例
export const knowledgeBase = new KnowledgeBase();

// 默认加载知识库
export async function loadDefaultKnowledgeBase(): Promise<Document[]> {
  // 尝试多个可能的路径
  const possiblePaths = [
    '../data/securityKnowledge.json',
    '../../data/securityKnowledge.json',
    './data/securityKnowledge.json',
    '../src/data/securityKnowledge.json'
  ];
  
  for (const path of possiblePaths) {
    try {
      console.log(`[知识库] 尝试加载路径: ${path}`);
      const docs = await knowledgeBase.loadFromFile(path);
      if (docs.length > 0) {
        console.log(`[知识库] 成功从 ${path} 加载知识库`);
        return docs;
      }
    } catch {
      console.log(`[知识库] 无法从 ${path} 加载知识库`);
    }
  }
  
  console.warn('[知识库] 所有路径都无法加载知识库，将使用内置知识');
  return createDefaultKnowledge();
}

// 创建默认的内置知识
function createDefaultKnowledge(): Document[] {
  console.log('[知识库] 创建内置知识库');
  
  const defaultDocs = [
    {
      pageContent: "SQL注入是一种常见的安全漏洞，攻击者可以通过注入SQL语句破坏数据库查询逻辑。应使用参数化查询或ORM框架防止SQL注入。",
      metadata: { 
        category: "sql-injection", 
        severity: "high",
        id: "SEC-001",
        tags: ["database", "injection", "query"]
      }
    },
    {
      pageContent: "XSS攻击通过在网页中注入恶意脚本，可能导致信息泄露或会话劫持。应使用内容安全策略(CSP)、输入验证和安全的模板系统。",
      metadata: { 
        category: "xss", 
        severity: "high",
        id: "SEC-002",
        tags: ["web", "javascript", "injection"]
      }
    },
    {
      pageContent: "硬编码的密钥和敏感数据可能导致数据泄露。应使用环境变量、配置文件或密钥管理系统来存储敏感信息。",
      metadata: { 
        category: "sensitive-data", 
        severity: "medium",
        id: "SEC-003",
        tags: ["credentials", "secrets", "configuration"]
      }
    }
  ].map(item => new Document({
    pageContent: item.pageContent,
    metadata: item.metadata
  }));
  
  // 添加到知识库
  knowledgeBase.addDocuments(defaultDocs);
  
  return defaultDocs;
} 