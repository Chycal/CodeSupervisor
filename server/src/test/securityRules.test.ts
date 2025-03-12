import * as assert from 'assert';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { runSecurityRules, securityRuleRegistry } from '../securityRules';
import { DiagnosticSeverity } from 'vscode-languageserver';

describe('安全规则测试', () => {
  // 创建文档辅助函数
  function createDocument(content: string): TextDocument {
    return TextDocument.create('file:///test.js', 'javascript', 1, content);
  }

  describe('SQL 注入规则测试', () => {
    it('应检测字符串拼接 SQL 查询 (SQL-01)', async () => {
      const code = `const query = "SELECT * FROM users WHERE username = '" + username + "'";`;
      const document = createDocument(code);
      const diagnostics = await runSecurityRules(document);
      
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(diagnostics[0].message.includes('SQL注入'), true);
    });

    it('不应标记参数化 SQL 查询 (SQL-02)', async () => {
      const code = `const query = "SELECT * FROM users WHERE username = ?";
                   db.query(query, [username]);`;
      const document = createDocument(code);
      const diagnostics = await runSecurityRules(document);
      
      // 不应有 SQL 注入检测结果
      assert.strictEqual(diagnostics.length, 0);
    });

    it('应检测带用户输入的动态 SQL (SQL-03)', async () => {
      const code = `const query = \`SELECT * FROM users WHERE role = \${userRole}\`;`;
      const document = createDocument(code);
      const diagnostics = await runSecurityRules(document);
      
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(diagnostics[0].message.includes('SQL注入'), true);
    });
  });

  describe('XSS 规则测试', () => {
    it('应检测直接设置 innerHTML (XSS-01)', async () => {
      const code = `element.innerHTML = userInput;`;
      const document = createDocument(code);
      const diagnostics = await runSecurityRules(document);
      
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(diagnostics[0].message.includes('XSS'), true);
    });

    it('不应标记安全的 DOM 操作 (XSS-02)', async () => {
      const code = `element.textContent = userInput;`;
      const document = createDocument(code);
      const diagnostics = await runSecurityRules(document);
      
      // 不应有 XSS 检测结果
      assert.strictEqual(diagnostics.length, 0);
    });

    it('应检测 jQuery HTML 操作 (XSS-03)', async () => {
      const code = `$('#element').html(userInput);`;
      const document = createDocument(code);
      const diagnostics = await runSecurityRules(document);
      
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(diagnostics[0].message.includes('XSS'), true);
    });
  });

  describe('敏感数据规则测试', () => {
    it('应检测硬编码 API 密钥 (DATA-01)', async () => {
      const code = `const apiKey = "sk_test_1234567890abcdef";`;
      const document = createDocument(code);
      const diagnostics = await runSecurityRules(document);
      
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(diagnostics[0].message.includes('敏感数据'), true);
    });

    it('不应标记环境变量中的密钥 (DATA-02)', async () => {
      const code = `const apiKey = process.env.API_KEY;`;
      const document = createDocument(code);
      const diagnostics = await runSecurityRules(document);
      
      // 不应有敏感数据检测结果
      assert.strictEqual(diagnostics.length, 0);
    });

    it('应检测日志中的敏感数据 (DATA-03)', async () => {
      const code = `console.log("Password is:", userPassword);`;
      const document = createDocument(code);
      const diagnostics = await runSecurityRules(document);
      
      assert.strictEqual(diagnostics.length, 1);
      assert.strictEqual(diagnostics[0].message.includes('敏感数据'), true);
    });
  });

  describe('规则注册系统测试', () => {
    it('应能获取所有注册的规则', () => {
      const rules = securityRuleRegistry.getRules();
      assert.strictEqual(rules.length >= 3, true); // 应至少有三条内置规则
    });

    it('应能通过 ID 获取特定规则', () => {
      const rule = securityRuleRegistry.getRule('security-sql-injection');
      assert.strictEqual(rule !== undefined, true);
      assert.strictEqual(rule?.name, 'SQL Injection Detection');
    });

    it('应能注册新规则并运行', async () => {
      // 创建一个新的测试规则
      const testRule = {
        id: 'security-test-rule',
        name: 'Test Rule',
        description: '测试规则',
        severity: DiagnosticSeverity.Information, // 使用正确的枚举类型
        validate: async (document: TextDocument) => {
          const text = document.getText();
          if (text.includes('TEST_PATTERN')) {
            return [{
              severity: DiagnosticSeverity.Information, // 使用正确的枚举类型
              range: {
                start: document.positionAt(text.indexOf('TEST_PATTERN')),
                end: document.positionAt(text.indexOf('TEST_PATTERN') + 12)
              },
              message: '测试规则触发',
              source: 'security-assistant'
            }];
          }
          return [];
        }
      };
      
      // 注册规则
      securityRuleRegistry.registerRule(testRule);
      
      // 验证规则被注册
      const rule = securityRuleRegistry.getRule('security-test-rule');
      assert.strictEqual(rule !== undefined, true);
      
      // 测试规则运行
      const code = `const test = "TEST_PATTERN";`;
      const document = createDocument(code);
      const diagnostics = await runSecurityRules(document);
      
      // 应检测到测试模式
      assert.strictEqual(diagnostics.some(d => d.message === '测试规则触发'), true);
    });
  });
}); 