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
        // const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'client', 'src', 'view', 'dashboard.html');
        // const htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf-8');
        // webviewView.webview.html = htmlContent;
        // 处理Webview消息
        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'gotoLine':
                    this._gotoLine(message.line);
                    return;
                case 'repair':
                    this._repairIssues(message.issues);
                    return;
                case 'requestInitialData':
                    // 发送当前数据给Webview
                    this._sendInitialData();
                    return;
                case 'showMessage':
                    vscode.window.showInformationMessage(message.text);
                    return;
                case 'refresh':
                    // 用户请求强制刷新数据
                    if (message.requestLatestData) {
                        console.log("[安全仪表盘] 用户请求刷新数据");
                        // 先显示加载状态
                        this._view.webview.postMessage({
                            command: 'updateScore',
                            score: this._score || 100
                        });
                        
                        // 执行刷新命令，触发文件扫描
                        vscode.commands.executeCommand('security-assistant.diagnostics.refresh')
                            .then(() => {
                                console.log("[安全仪表盘] 刷新命令执行完成，等待数据更新");
                                // 在命令执行完成后，主动发送最新数据
                                // 设置较长的延时确保诊断完成
                                setTimeout(() => {
                                    console.log("[安全仪表盘] 发送最新数据到前端");
                                    this._sendInitialData();
                                }, 1500);
                            },
                            (error) => {
                                console.error("[安全仪表盘] 刷新命令执行失败:", error);
                                // 显示错误消息
                                vscode.window.showErrorMessage(`刷新失败: ${error.message || "未知错误"}`);
                            });
                    }
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
            console.log(`[安全仪表盘] 接收到更新请求，漏洞数量: ${issues.length}, 安全评分: ${score}`);
            
            // 计算漏洞数量统计
            const vulnerabilityNumber = this._calculateVulnerabilityNumbers();
            
            // 检查是否有实际的漏洞数据
            const totalIssues = vulnerabilityNumber.critical + vulnerabilityNumber.high + 
                               vulnerabilityNumber.medium + vulnerabilityNumber.low;
            
            if (totalIssues === 0 && issues.length === 0) {
                console.log('[安全仪表盘] 没有漏洞数据，只更新安全评分');
                // 只更新安全评分，不触发图表重绘
                this._view.webview.postMessage({
                    command: 'updateScore',
                    score: score
                });
                return;
            }
            
            // 获取系统状态
            const systemStatus = {
                running: true,
                lastAnalysis: this._getLastAnalysisTime(),
                engineVersion: this._getEngineVersion()
            };
            
            // 只发送必要的更新，减少不必要的图表刷新
            if (issues.length > 0) {
                console.log(`[安全仪表盘] 更新漏洞数据: ${JSON.stringify(vulnerabilityNumber)}, 安全评分: ${score}`);
                // 发送refresh指令更新漏洞列表
                this._view.webview.postMessage({
                    command: 'refresh',
                    issues: issues,
                    score: score,
                    llmInfo: {
                        name: 'DeepSeek',
                        autoFix: true,
                        ragEnabled: true,
                        knowledgeFiles: [
                            { name: 'OWASP Top 10 & CWE Top 250 文档(2024).pdf' },
                            { name: '公司安全编码规范.md' }
                        ]
                    }
                });
            
                // 等待一段时间再更新图表，避免频繁刷新
                setTimeout(() => {
                    // 同时发送updateDashboard指令直接更新图表
                    this._view.webview.postMessage({
                        command: 'updateDashboard',
                        vulnerabilityNumber: vulnerabilityNumber,
                        securityScore: score,
                        systemStatus: systemStatus
                    });
                }, 300); // 300ms延迟，给前端足够时间处理漏洞列表更新
            }
        }
    }
    
    /**
     * 生成Webview的HTML内容
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {

        // 获取HTML文件路径
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'client', 'src', 'view', 'dashboard.html');
        
        // 读取HTML文件内容
        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf-8');
        // 获取资源文件路径
        const cssPath = vscode.Uri.joinPath(this._extensionUri, 'client', 'src', 'assets', 'dashboard.css');
        const cssUri = webview.asWebviewUri(cssPath);
        
        // 替换CSS路径
        htmlContent = htmlContent.replace('<link rel="stylesheet" href="dashboard.css">', `<link rel="stylesheet" href="${cssUri}">`);
        
        
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
    
    /**
     * 发送初始数据到Webview
     * 注意：此方法现在只在主动调用或有真实更新时触发
     */
    private _sendInitialData() {
        if (!this._view) {
            return;
        }
        
        // 如果没有任何漏洞数据，则不发送更新
        if (this._issues.length === 0) {
            console.log('[安全仪表盘] 没有漏洞数据，跳过图表更新');
            return;
        }
        
        // 获取系统状态信息
        const systemStatus = {
            running: true,
            lastAnalysis: this._getLastAnalysisTime(),
            engineVersion: this._getEngineVersion()
        };
        
        // 从现有诊断计算漏洞数量
        const vulnerabilityNumber = this._calculateVulnerabilityNumbers();
        
        console.log('[安全仪表盘] 发送真实数据更新，漏洞数据:', JSON.stringify(vulnerabilityNumber));
        
        // 发送初始数据到Webview
        this._view.webview.postMessage({
            command: 'updateDashboard',
            vulnerabilityNumber: vulnerabilityNumber,
            securityScore: this._score,
            systemStatus: systemStatus
        });
    }
    
    /**
     * 计算各危险级别的漏洞数量
     */
    private _calculateVulnerabilityNumbers() {
        // 默认值
        const vulnerabilityNumber = {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0
        };
        
        // 根据当前的issue列表统计各级别漏洞数量
        this._issues.forEach(issue => {
            switch (issue.severity) {
                case 'critical':
                    vulnerabilityNumber.critical++;
                    break;
                case 'high':
                    vulnerabilityNumber.high++;
                    break;
                case 'medium':
                    vulnerabilityNumber.medium++;
                    break;
                case 'low':
                    vulnerabilityNumber.low++;
                    break;
            }
        });
        
        return vulnerabilityNumber;
    }
    
    /**
     * 获取最后分析时间
     */
    private _getLastAnalysisTime(): string {
        // 这里可以从某个持久化存储中获取最后分析时间
        // 临时返回当前时间
        return new Date().toLocaleString();
    }
    
    /**
     * 获取引擎版本
     */
    private _getEngineVersion(): string {
        // 这里可以返回实际的引擎版本
        return '1.5.0';
    }
} 