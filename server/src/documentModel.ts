/**
 * 文档元数据接口
 */
export interface DocumentMetadata {
  category: string;
  severity: string;
  id?: string;
  tags?: string[];
  [key: string]: string | string[] | number | boolean | undefined;
}

/**
 * 文档接口
 */
export interface DocumentType {
  pageContent: string;
  metadata: DocumentMetadata;
}

/**
 * 文档类，用于表示知识库中的文档
 */
export class Document implements DocumentType {
  pageContent: string;
  metadata: DocumentMetadata;

  constructor({ pageContent, metadata }: { pageContent: string; metadata: DocumentMetadata }) {
    this.pageContent = pageContent;
    this.metadata = metadata;
  }

  /**
   * 获取文档内容
   */
  getContent(): string {
    return this.pageContent;
  }

  /**
   * 获取文档元数据
   */
  getMetadata(): DocumentMetadata {
    return this.metadata;
  }

  /**
   * 获取文档类别
   */
  getCategory(): string {
    return this.metadata.category;
  }

  /**
   * 获取文档严重性
   */
  getSeverity(): string {
    return this.metadata.severity;
  }

  /**
   * 获取文档ID
   */
  getId(): string | undefined {
    return this.metadata.id;
  }

  /**
   * 获取文档标签
   */
  getTags(): string[] | undefined {
    return this.metadata.tags;
  }

  /**
   * 将文档转换为字符串
   */
  toString(): string {
    return `[${this.metadata.id || 'Unknown'}] ${this.pageContent}`;
  }

  /**
   * 将文档转换为JSON
   */
  toJSON(): { pageContent: string; metadata: DocumentMetadata } {
    return {
      pageContent: this.pageContent,
      metadata: this.metadata
    };
  }
} 