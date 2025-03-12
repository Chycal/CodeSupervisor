import * as vscode from 'vscode';
import { SecurityIssue } from './types';

/**
 * 诊断项目类型
 */
export enum DiagnosticItemType {
    Category,  // 分类（严重、高危、中危、低危）
    Issue      // 具体问题
}

/**
 * 诊断树项
 */
export class DiagnosticItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly type: DiagnosticItemType,
        public readonly issue?: SecurityIssue,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(label, collapsibleState);

        // 设置图标
        if (type === DiagnosticItemType.Category) {
            this.iconPath = new vscode.ThemeIcon('warning');
            this.contextValue = 'category';
        } else if (issue) {
            // 根据严重性设置不同的图标
            switch (issue.severity) {
                case 'critical':
                    this.iconPath = new vscode.ThemeIcon('error');
                    break;
                case 'high':
                    this.iconPath = new vscode.ThemeIcon('warning');
                    break;
                case 'medium':
                    this.iconPath = new vscode.ThemeIcon('info');
                    break;
                case 'low':
                    this.iconPath = new vscode.ThemeIcon('debug');
                    break;
            }
            
            // 设置tooltip
            this.tooltip = issue.message;
            this.description = `${issue.filename.split('/').pop()}:${issue.line}`;
            this.contextValue = 'issue';
            
            // 点击时跳转到对应位置
            this.command = {
                title: '跳转到问题位置',
                command: 'security-assistant.diagnostics.gotoIssue',
                arguments: [issue]
            };
        }
    }
}

/**
 * 诊断树数据提供者
 */
export class DiagnosticTreeDataProvider implements vscode.TreeDataProvider<DiagnosticItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DiagnosticItem | undefined | null | void> = new vscode.EventEmitter<DiagnosticItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<DiagnosticItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private _issues: SecurityIssue[] = [];
    
    constructor() {}
    
    /**
     * 更新诊断问题列表
     */
    public updateIssues(issues: SecurityIssue[]): void {
        this._issues = issues;
        // 仅在调试模式或问题数量变化时输出日志
        if (vscode.workspace.getConfiguration('securityAssistant').get('debugMode') === true || 
            this._issues.length !== issues.length) {
            console.log(`[诊断树视图] 更新诊断问题: ${this._issues.length} 个问题`);
        }
        this._onDidChangeTreeData.fire();
    }
    
    /**
     * 清空诊断问题
     */
    public clearIssues(): void {
        this._issues = [];
        this._onDidChangeTreeData.fire();
    }
    
    /**
     * 获取树项子项
     */
    getChildren(element?: DiagnosticItem): Thenable<DiagnosticItem[]> {
        if (!element) {
            // 根节点，返回分类
            const categories = this._getCategories();
            return Promise.resolve(categories);
        } else if (element.type === DiagnosticItemType.Category) {
            // 分类节点，返回该分类下的问题
            const issuesInCategory = this._getIssuesForCategory(element.label);
            return Promise.resolve(issuesInCategory);
        }
        
        return Promise.resolve([]);
    }
    
    /**
     * 获取树项
     */
    getTreeItem(element: DiagnosticItem): vscode.TreeItem {
        return element;
    }
    
    /**
     * 获取分类节点
     */
    private _getCategories(): DiagnosticItem[] {
        // 如果没有问题，显示一个空状态
        if (this._issues.length === 0) {
            return [new DiagnosticItem('没有发现问题', DiagnosticItemType.Category)];
        }
        
        // 创建四个固定分类：严重、高危、中危、低危
        const categories: DiagnosticItem[] = [];
        
        // 统计各类别的数量
        const criticalCount = this._issues.filter(issue => issue.severity === 'critical').length;
        const highCount = this._issues.filter(issue => issue.severity === 'high').length;
        const mediumCount = this._issues.filter(issue => issue.severity === 'medium').length;
        const lowCount = this._issues.filter(issue => issue.severity === 'low').length;
        
        // 只添加有问题的分类
        if (criticalCount > 0) {
            categories.push(new DiagnosticItem(
                `严重问题 (${criticalCount})`,
                DiagnosticItemType.Category,
                undefined,
                vscode.TreeItemCollapsibleState.Expanded
            ));
        }
        
        if (highCount > 0) {
            categories.push(new DiagnosticItem(
                `高危问题 (${highCount})`,
                DiagnosticItemType.Category,
                undefined,
                vscode.TreeItemCollapsibleState.Expanded
            ));
        }
        
        if (mediumCount > 0) {
            categories.push(new DiagnosticItem(
                `中危问题 (${mediumCount})`,
                DiagnosticItemType.Category,
                undefined,
                vscode.TreeItemCollapsibleState.Expanded
            ));
        }
        
        if (lowCount > 0) {
            categories.push(new DiagnosticItem(
                `低危问题 (${lowCount})`,
                DiagnosticItemType.Category,
                undefined,
                vscode.TreeItemCollapsibleState.Expanded
            ));
        }
        
        return categories;
    }
    
    /**
     * 获取特定分类下的问题
     */
    private _getIssuesForCategory(category: string): DiagnosticItem[] {
        let severity: "critical" | "high" | "medium" | "low";
        
        // 简单地根据分类标题确定严重性
        if (category.startsWith('严重')) {
            severity = 'critical';
        } else if (category.startsWith('高危')) {
            severity = 'high';
        } else if (category.startsWith('中危')) {
            severity = 'medium';
        } else if (category.startsWith('低危')) {
            severity = 'low';
        } else {
            return [];
        }
        
        // 过滤对应严重性的问题
        return this._issues
            .filter(issue => issue.severity === severity)
            .map(issue => {
                // 只提取规则名称，避免显示冗长的消息
                // 如果有规则ID，则直接使用规则ID作为显示名称
                let ruleName = issue.rule || 'unknown';
                // 如果规则ID不存在或为unknown，尝试从消息中提取第一行作为名称
                if (ruleName === 'unknown' && issue.message) {
                    ruleName = issue.message.split('\n')[0].trim();
                    // 如果消息过长，进行截断
                    if (ruleName.length > 50) {
                        ruleName = ruleName.substring(0, 47) + '...';
                    }
                }
                
                // 文件名（取最后一部分）
                const fileName = issue.filename.split(/[/\\]/).pop() || '';
                
                // 创建简洁易读的标签 - 仅显示规则名称，文件和行号作为描述
                const label = `${ruleName}`;
                
                const item = new DiagnosticItem(
                    label,
                    DiagnosticItemType.Issue,
                    issue
                );
                
                // 将文件名和行号设置为描述
                item.description = `${fileName}:${issue.line}`;
                
                return item;
            });
    }
} 