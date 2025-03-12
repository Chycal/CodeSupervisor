import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

// 端到端测试需要一定的时间来启动扩展和LSP服务器
const EXTENSION_STARTUP_TIME = 3000; // 毫秒

// 辅助函数：等待指定时间
async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 辅助函数：创建临时测试文件
async function createTestFile(content: string): Promise<vscode.Uri> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('无法获取工作区文件夹');
  }
  
  const testFilePath = path.join(workspaceFolder.uri.fsPath, 'test.js');
  const testFileUri = vscode.Uri.file(testFilePath);
  
  const encoder = new TextEncoder();
  await vscode.workspace.fs.writeFile(testFileUri, encoder.encode(content));
  
  return testFileUri;
}

// 辅助函数：清理测试文件
async function cleanupTestFile(uri: vscode.Uri): Promise<void> {
  try {
    await vscode.workspace.fs.delete(uri);
  } catch (error) {
    console.error('清理测试文件失败:', error);
  }
}

suite('安全编码助手扩展端到端测试', () => {
  // 在所有测试开始前等待扩展激活
  suiteSetup(async () => {
    // 等待扩展完全激活
    await wait(EXTENSION_STARTUP_TIME);
  });
  
  test('应显示安全诊断问题', async () => {
    // 准备含有安全问题的测试文件
    const testContent = `
      // SQL注入风险
      const query = "SELECT * FROM users WHERE id = " + userId;
      
      // XSS风险
      element.innerHTML = userInput;
      
      // 敏感数据风险
      const apiKey = "sk_test_1234567890";
    `;
    
    const testFileUri = await createTestFile(testContent);
    
    try {
      // 打开测试文件
      const document = await vscode.workspace.openTextDocument(testFileUri);
      await vscode.window.showTextDocument(document);
      
      // 等待诊断信息生成
      await wait(2000);
      
      // 获取诊断信息
      const diagnostics = vscode.languages.getDiagnostics(testFileUri);
      
      // 验证至少应有 3 个安全问题
      assert.strictEqual(diagnostics.length >= 3, true, '应检测到至少3个安全问题');
      
      // 验证诊断信息来源是我们的扩展
      const fromExtension = diagnostics.some(d => d.source === 'security-assistant');
      assert.strictEqual(fromExtension, true, '诊断应来自安全编码助手');
      
      // 验证诊断类型
      const hasSqlInjection = diagnostics.some(d => d.message.includes('SQL'));
      const hasXss = diagnostics.some(d => d.message.includes('XSS'));
      const hasSensitiveData = diagnostics.some(d => d.message.includes('敏感数据'));
      
      assert.strictEqual(hasSqlInjection, true, '应检测到SQL注入风险');
      assert.strictEqual(hasXss, true, '应检测到XSS风险');
      assert.strictEqual(hasSensitiveData, true, '应检测到敏感数据风险');
    } finally {
      // 清理测试文件
      await cleanupTestFile(testFileUri);
    }
  }).timeout(10000); // 给予足够的时间执行
  
  test('安全分析命令应可用', async () => {
    // 验证命令是否注册
    const commands = await vscode.commands.getCommands();
    const hasAnalyzeCommand = commands.includes('security-assistant.analyzeCode');
    
    assert.strictEqual(hasAnalyzeCommand, true, '应注册代码安全分析命令');
  });
  
  test('Ghost Text切换命令应可用', async () => {
    // 验证命令是否注册
    const commands = await vscode.commands.getCommands();
    const hasToggleCommand = commands.includes('security-assistant.toggleGhostText');
    
    assert.strictEqual(hasToggleCommand, true, '应注册Ghost Text切换命令');
  });
}); 