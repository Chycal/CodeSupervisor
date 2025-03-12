import * as vscode from 'vscode';
import {
  LanguageClient,
  CompletionRequest,
  TextDocumentPositionParams,
  CompletionItem,
  CompletionList
} from 'vscode-languageclient/node';

// Ghost Text提供程序
export class GhostTextProvider implements vscode.InlineCompletionItemProvider {
  private client: LanguageClient;
  private disposables: vscode.Disposable[] = [];
  private lastPosition: vscode.Position | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private isActive = true;

  constructor(client: LanguageClient) {
    this.client = client;
    this.disposables.push(
      vscode.commands.registerCommand('security-assistant.toggleGhostText', () => {
        this.isActive = !this.isActive;
        vscode.window.showInformationMessage(
          `安全建议Ghost Text已${this.isActive ? '启用' : '禁用'}`
        );
      })
    );
  }

  // 提供内联完成项
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    // 如果禁用或取消，返回空
    if (!this.isActive || token.isCancellationRequested) {
      return null;
    }

    // 获取配置
    const config = vscode.workspace.getConfiguration('securityAssistant');
    const enableGhostText = config.get<boolean>('enableGhostText', true);
    const debounceTime = config.get<number>('ghostTextDebounceTime', 300);
    
    // 如果在配置中禁用，返回空
    if (!enableGhostText) {
      console.log('[GhostText] 在配置中禁用');
      return null;
    }

    console.log('[GhostText] 请求代码补全，位置:', position.line, position.character);

    // 如果用户正在快速输入，则不提供建议
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // 记录当前位置，用于后续处理
    this.lastPosition = position;

    // 使用防抖来避免频繁请求
    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(async () => {
        try {
          // 准备请求参数
          const params: TextDocumentPositionParams = {
            textDocument: {
              uri: document.uri.toString()
            },
            position: {
              line: position.line,
              character: position.character
            }
          };

          console.log('[GhostText] 发送LSP请求:', params);

          // 请求LSP服务器获取补全
          const completions = await this.client.sendRequest(
            CompletionRequest.type,
            params
          ) as CompletionList | CompletionItem[];

          console.log('[GhostText] 收到补全响应:', completions);

          // 处理返回的补全项
          if (completions) {
            // 确保位置没有改变
            if (this.lastPosition?.isEqual(position)) {
              const items: vscode.InlineCompletionItem[] = [];
              
              // 处理不同类型的补全结果
              const completionItems = 'items' in completions 
                ? completions.items 
                : completions;
              
              console.log('[GhostText] 处理补全项数量:', completionItems.length);
              
              if (completionItems.length > 0) {
                completionItems
                  .filter(item => item.insertText)
                  .forEach(item => {
                    // 获取当前行文本
                    const lineText = document.lineAt(position.line).text;
                    const textBeforeCursor = lineText.substring(0, position.character);
                    
                    // 获取插入文本
                    const insertText = typeof item.insertText === 'string' 
                      ? item.insertText 
                      : item.label.toString();
                    
                    // 检查是否有重复
                    if (insertText.startsWith(textBeforeCursor)) {
                      // 如果补全内容以当前行内容开头，只保留未输入的部分
                      const nonDuplicateText = insertText.substring(textBeforeCursor.length);
                      
                      // 如果去重后没有内容，则跳过此补全项
                      if (nonDuplicateText.trim().length === 0) {
                        console.log('[GhostText] 跳过重复的补全项');
                        return;
                      }
                      
                      console.log('[GhostText] 移除重复内容:', textBeforeCursor);
                      console.log('[GhostText] 保留内容:', nonDuplicateText);
                      
                      // 创建内联补全项，只包含非重复部分
                      const inlineItem = new vscode.InlineCompletionItem(
                        nonDuplicateText,
                        new vscode.Range(position, position)
                      );
                      
                      // 创建标记，添加安全图标和提示
                      inlineItem.command = {
                        title: '安全建议',
                        command: 'security-assistant.showSecurityAdvice',
                        arguments: [document.uri, position, '这是由安全编码助手提供的建议']
                      };
                      
                      items.push(inlineItem);
                    } else if (textBeforeCursor.endsWith(insertText.substring(0, Math.min(insertText.length, textBeforeCursor.length)))) {
                      // 处理部分重叠的情况
                      // 例如：已输入"const user"，补全为"user = getUser()"
                      // 找到重叠部分的长度
                      let overlapLength = 0;
                      for (let i = 1; i <= Math.min(textBeforeCursor.length, insertText.length); i++) {
                        if (textBeforeCursor.endsWith(insertText.substring(0, i))) {
                          overlapLength = i;
                        }
                      }
                      
                      if (overlapLength > 0) {
                        // 只保留非重叠部分
                        const nonOverlapText = insertText.substring(overlapLength);
                        
                        console.log('[GhostText] 检测到部分重叠，长度:', overlapLength);
                        console.log('[GhostText] 保留非重叠内容:', nonOverlapText);
                        
                        // 创建内联补全项，只包含非重叠部分
                        const inlineItem = new vscode.InlineCompletionItem(
                          nonOverlapText,
                          new vscode.Range(position, position)
                        );
                        
                        // 创建标记，添加安全图标和提示
                        inlineItem.command = {
                          title: '安全建议',
                          command: 'security-assistant.showSecurityAdvice',
                          arguments: [document.uri, position, '这是由安全编码助手提供的建议']
                        };
                        
                        items.push(inlineItem);
                      } else {
                        // 没有重叠，使用原始补全项
                        const inlineItem = new vscode.InlineCompletionItem(
                          insertText,
                          new vscode.Range(position, position)
                        );
                        
                        // 创建标记，添加安全图标和提示
                        inlineItem.command = {
                          title: '安全建议',
                          command: 'security-assistant.showSecurityAdvice',
                          arguments: [document.uri, position, '这是由安全编码助手提供的建议']
                        };
                        
                        items.push(inlineItem);
                      }
                    } else {
                      // 没有重复，使用原始补全项
                      const inlineItem = new vscode.InlineCompletionItem(
                        insertText,
                        new vscode.Range(position, position)
                      );
                      
                      // 创建标记，添加安全图标和提示
                      inlineItem.command = {
                        title: '安全建议',
                        command: 'security-assistant.showSecurityAdvice',
                        arguments: [document.uri, position, '这是由安全编码助手提供的建议']
                      };
                      
                      items.push(inlineItem);
                    }
                  });
                
                if (items.length > 0) {
                  console.log('[GhostText] 返回内联补全项:', items.length);
                  resolve(items);
                  return;
                }
              }
            }
          }
          console.log('[GhostText] 无可用补全项');
          resolve(null);
        } catch (error) {
          console.error('[GhostText] 请求失败:', error);
          resolve(null);
        }
      }, debounceTime); // 使用配置中的防抖时间
    });
  }

  // 释放资源
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
} 