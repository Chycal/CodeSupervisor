// 模型配置接口
export interface ModelConfig {
  name: string;
  baseUrl: string;
  modelName: string;
  temperature: number;
  embeddingModel?: string;
  useEmbeddings: boolean;
}

// 模型配置
export const modelConfigs: Record<string, ModelConfig> = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelName: 'gpt-4o',
    temperature: 0.1,
    embeddingModel: 'text-embedding-3-small',
    useEmbeddings: true
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelName: 'deepseek-v3-241226',
	//   modelName: 'deepseek-r1-250120',
    temperature: 0.1,
    embeddingModel: undefined,
    useEmbeddings: true
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    modelName: 'claude-3-opus-20240229',
    temperature: 0.1,
    embeddingModel: undefined,
    useEmbeddings: false
  }
};

// 默认模型
export const defaultModel = 'deepseek';

// 获取模型配置
export function getModelConfig(modelId: string): ModelConfig | null {
  return modelConfigs[modelId] || null;
}

// 获取默认模型ID
export function getDefaultModelId(): string {
  return defaultModel;
}

// 获取所有可用模型ID
export function getAvailableModelIds(): string[] {
  return Object.keys(modelConfigs);
} 