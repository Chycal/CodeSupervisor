import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

// 安全规则接口
export interface SecurityRule {
  id: string;
  name: string;
  description: string;
  severity: DiagnosticSeverity;
  validate: (document: TextDocument) => Promise<Diagnostic[]>;
}

// 安全规则注册表
class SecurityRuleRegistry {
  private rules = new Map<string, SecurityRule>();

  registerRule(rule: SecurityRule): void {
    this.rules.set(rule.id, rule);
  }

  getRules(): SecurityRule[] {
    return Array.from(this.rules.values());
  }

  getRule(id: string): SecurityRule | undefined {
    return this.rules.get(id);
  }
}

// 创建注册表实例
export const securityRuleRegistry = new SecurityRuleRegistry();

// SQL注入风险检测规则
const sqlInjectionRule: SecurityRule = {
  id: 'security-sql-injection',
  name: 'SQL Injection Detection',
  description: '检测可能导致SQL注入的代码模式',
  severity: DiagnosticSeverity.Error,
  validate: async (document: TextDocument): Promise<Diagnostic[]> => {
    const text = document.getText();
    const diagnostics: Diagnostic[] = [];
    
    // 检测常见的SQL注入模式
    const sqlInjectionPatterns = [
      /\b(SELECT|INSERT|UPDATE|DELETE|DROP)\b.*\+\s*[\w.]+/gi,
      /\bexecute\s*\(\s*.*\+\s*[\w.]+/gi,
      /\bexecSql\s*\(\s*.*\+\s*[\w.]+/gi
    ];
    
    for (const pattern of sqlInjectionPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: document.positionAt(match.index),
            end: document.positionAt(match.index + match[0].length)
          },
          message: '可能存在SQL注入风险，建议使用参数化查询',
          source: 'security-assistant'
        });
      }
    }
    
    return diagnostics;
  }
};

// XSS风险检测规则
const xssVulnerabilityRule: SecurityRule = {
  id: 'security-xss',
  name: 'Cross-Site Scripting Detection',
  description: '检测可能导致XSS攻击的代码模式',
  severity: DiagnosticSeverity.Error,
  validate: async (document: TextDocument): Promise<Diagnostic[]> => {
    const text = document.getText();
    const diagnostics: Diagnostic[] = [];
    
    // 检测常见的XSS风险模式
    const xssPatterns = [
      /\b(innerHTML|outerHTML)\s*=\s*[\w.]+/gi,
      /document\.write\s*\(\s*[\w.]+\s*\)/gi,
      /\$\s*\(\s*.*\s*\)\.html\s*\(\s*[\w.]+\s*\)/gi
    ];
    
    for (const pattern of xssPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: document.positionAt(match.index),
            end: document.positionAt(match.index + match[0].length)
          },
          message: '可能存在XSS风险，建议使用安全的DOM API或模板',
          source: 'security-assistant'
        });
      }
    }
    
    return diagnostics;
  }
};

// 敏感数据暴露风险检测规则
const sensitiveDataRule: SecurityRule = {
  id: 'security-sensitive-data',
  name: 'Sensitive Data Exposure',
  description: '检测可能导致敏感数据暴露的代码模式',
  severity: DiagnosticSeverity.Warning,
  validate: async (document: TextDocument): Promise<Diagnostic[]> => {
    const text = document.getText();
    const diagnostics: Diagnostic[] = [];
    
    // 检测常见的敏感数据模式
    const sensitiveDataPatterns = [
      /\b(password|api[_-]?key|secret|token|credential)s?\s*=\s*(['"`])(?!process\.env)[^'"`]+\2/gi,
      /\bconsole\.(log|debug|info)\s*\(.*\b(password|apiKey|secret|token)\b.*\)/gi,
    ];
    
    for (const pattern of sensitiveDataPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: {
            start: document.positionAt(match.index),
            end: document.positionAt(match.index + match[0].length)
          },
          message: '敏感数据可能被硬编码或泄露，建议使用环境变量或密钥管理系统',
          source: 'security-assistant'
        });
      }
    }
    
    return diagnostics;
  }
};

// 注册内置规则
securityRuleRegistry.registerRule(sqlInjectionRule);
securityRuleRegistry.registerRule(xssVulnerabilityRule);
securityRuleRegistry.registerRule(sensitiveDataRule);

// 运行所有注册的安全规则
export async function runSecurityRules(document: TextDocument): Promise<Diagnostic[]> {
  const allDiagnostics: Diagnostic[] = [];
  const rules = securityRuleRegistry.getRules();
  
  console.log(`[安全规则] 开始检查文档: ${document.uri}, 应用 ${rules.length} 条规则`);
  
  for (const rule of rules) {
    console.log(`[安全规则] 应用规则: ${rule.name}`);
    try {
      const diagnostics = await rule.validate(document);
      
      if (diagnostics.length > 0) {
        console.log(`[安全规则] 规则 "${rule.name}" 检测到 ${diagnostics.length} 个问题`);
        diagnostics.forEach(diagnostic => {
          allDiagnostics.push(diagnostic);
        });
      } else {
        console.log(`[安全规则] 规则 "${rule.name}" 未检测到问题`);
      }
    } catch (error) {
      console.error(`[安全规则] 规则 "${rule.name}" 执行出错:`, error);
    }
  }
  
  console.log(`[安全规则] 检查完成，共发现 ${allDiagnostics.length} 个问题`);
  return allDiagnostics;
} 