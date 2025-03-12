import * as vscode from 'vscode';
import * as fs from 'fs';
import { SecurityIssue } from './types';

/**
 * 安全侧边栏视图提供者
 * 负责在侧边栏中展示安全检测信息
 */
export class SecuritySidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'security-assistant.securityDashboard';
    
    private _view?: vscode.WebviewView;
    private _issues: SecurityIssue[] = [];
    private _score = 100;
    
    constructor(
        private readonly _extensionUri: vscode.Uri
    ) {}
    
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        
        // 设置Webview选项
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'client', 'src')
            ]
        };
        
        // 设置HTML内容
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        
        // 处理Webview消息
        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'gotoLine':
                    this._gotoLine(message.line);
                    return;
                case 'repair':
                    this._repairIssues(message.issues);
                    return;
            }
        });
    }
    
    /**
     * 更新安全检测信息
     */
    public updateIssues(issues: SecurityIssue[], score: number) {
        this._issues = issues;
        this._score = score;
        
        if (this._view) {
            this._view.webview.postMessage({
                command: 'refresh',
                issues: issues,
                score: score
            });
        }
    }
    
    /**
     * 生成Webview的HTML内容
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // 获取资源文件路径
        const cssPath = vscode.Uri.joinPath(this._extensionUri, 'client', 'src', 'assets', 'dashboard.css');
        const cssUri = webview.asWebviewUri(cssPath);
        
        // 获取HTML文件路径
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'client', 'src', 'view', 'dashboard.html');
        
        // 读取HTML文件内容
        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf-8');
        
        // 替换CSS路径
        htmlContent = htmlContent.replace('<link rel="stylesheet" href="dashboard.css">', `<link rel="stylesheet" href="${cssUri}">`);
        
        // 添加vscode webview API和初始数据
        htmlContent = htmlContent.replace('</head>', `
            <script>
                const vscode = acquireVsCodeApi();
                // 在页面加载时发送消息表示已准备好接收数据
                window.addEventListener('load', () => {
                    vscode.postMessage({ command: 'ready' });
                });
            </script>
        </head>`);
        
        return htmlContent;
    }
    
    /**
     * 跳转到指定行
     */
    private _gotoLine(line: number) {
        if (vscode.window.activeTextEditor) {
            const position = new vscode.Position(line - 1, 0);
            const range = new vscode.Range(position, position);
            vscode.window.activeTextEditor.selection = new vscode.Selection(position, position);
            vscode.window.activeTextEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        }
    }
    
    /**
     * 修复安全问题
     */
    private _repairIssues(issues: SecurityIssue[]) {
        // 这部分需要根据实际的修复逻辑来实现
        vscode.window.showInformationMessage(`准备修复 ${issues.length} 个安全问题`);
    }
} 