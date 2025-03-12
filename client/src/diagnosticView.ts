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
        // 统计各类问题数量
        const criticalCount = this._issues.filter(i => i.severity === 'critical').length;
        const highCount = this._issues.filter(i => i.severity === 'high').length;
        const mediumCount = this._issues.filter(i => i.severity === 'medium').length;
        const lowCount = this._issues.filter(i => i.severity === 'low').length;
        
        // 创建分类节点
        const categories: DiagnosticItem[] = [];
        
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
        
        if (categories.length === 0) {
            // 如果没有问题，显示一个空状态
            return [new DiagnosticItem('没有发现问题', DiagnosticItemType.Category)];
        }
        
        return categories;
    }
    
    /**
     * 获取特定分类下的问题
     */
    private _getIssuesForCategory(category: string): DiagnosticItem[] {
        let severity: "critical" | "high" | "medium" | "low";
        
        // 根据分类名称确定对应的严重性
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
        
        // 过滤对应严重性的问题并创建树项
        return this._issues
            .filter(issue => issue.severity === severity)
            .map(issue => new DiagnosticItem(
                issue.message.split('\n')[0], // 使用第一行作为标题
                DiagnosticItemType.Issue,
                issue
            ));
    }
} 