# 安全编码助手测试文档

本文档提供了安全编码助手插件的全面测试指南，包括自动化测试和手动测试场景。

## 自动化测试

项目中包含以下类型的自动化测试：

1. **单元测试**: 测试各个独立组件的功能
2. **集成测试**: 测试组件之间的交互
3. **端到端测试**: 测试整个扩展在 VS Code 环境中的工作流

### 运行测试

在项目根目录执行以下命令运行所有测试：

```bash
npm test
```

要运行特定类型的测试：

```bash
# 单元测试
npm run test:unit

# 集成测试
npm run test:integration

# 端到端测试
npm run test:e2e
```

## 测试用例

### 安全规则测试

这些测试验证内置安全规则的功能。

#### SQL 注入规则测试

| 用例 ID | 说明 | 预期结果 |
|---------|------|----------|
| SQL-01 | 测试字符串拼接 SQL 查询 | 应检测并标记为 SQL 注入风险 |
| SQL-02 | 测试参数化 SQL 查询 | 不应标记为风险 |
| SQL-03 | 测试带用户输入的动态 SQL | 应检测并标记为 SQL 注入风险 |

**测试代码示例**:

```javascript
// SQL-01: 应标记为风险
const query1 = "SELECT * FROM users WHERE username = '" + username + "'";

// SQL-02: 不应标记为风险
const query2 = "SELECT * FROM users WHERE username = ?";
db.query(query2, [username]);

// SQL-03: 应标记为风险
const query3 = `SELECT * FROM users WHERE role = ${userRole}`;
```

#### XSS 规则测试

| 用例 ID | 说明 | 预期结果 |
|---------|------|----------|
| XSS-01 | 测试直接设置 innerHTML | 应检测并标记为 XSS 风险 |
| XSS-02 | 测试安全的 DOM 操作 | 不应标记为风险 |
| XSS-03 | 测试 jQuery HTML 操作 | 应检测并标记为 XSS 风险 |

**测试代码示例**:

```javascript
// XSS-01: 应标记为风险
element.innerHTML = userInput;

// XSS-02: 不应标记为风险
element.textContent = userInput;

// XSS-03: 应标记为风险
$('#element').html(userInput);
```

#### 敏感数据规则测试

| 用例 ID | 说明 | 预期结果 |
|---------|------|----------|
| DATA-01 | 测试硬编码 API 密钥 | 应检测并标记为敏感数据风险 |
| DATA-02 | 测试环境变量中的密钥 | 不应标记为风险 |
| DATA-03 | 测试日志中的敏感数据 | 应检测并标记为敏感数据风险 |

**测试代码示例**:

```javascript
// DATA-01: 应标记为风险
const apiKey = "sk_test_1234567890abcdef";

// DATA-02: 不应标记为风险
const apiKey = process.env.API_KEY;

// DATA-03: 应标记为风险
console.log("Password is:", userPassword);
```

### LLM 集成测试

这些测试验证 LLM 集成功能。

| 用例 ID | 说明 | 预期结果 |
|---------|------|----------|
| LLM-01 | 测试 LLM 初始化 | LLM 应正确初始化，日志显示成功 |
| LLM-02 | 测试无 API 密钥情况 | 应显示禁用 LLM 功能的日志 |
| LLM-03 | 测试 RAG 知识检索 | 应返回与代码相关的安全知识 |

### Ghost Text 测试

这些测试验证代码补全功能。

| 用例 ID | 说明 | 预期结果 |
|---------|------|----------|
| GT-01 | 测试基本代码补全 | 应在输入时显示补全建议 |
| GT-02 | 测试补全接受 | 按 Tab 键应接受补全建议 |
| GT-03 | 测试补全取消 | 继续输入或移动光标应取消补全 |
| GT-04 | 测试禁用/启用 | 切换命令应成功禁用和启用 Ghost Text |

### 代码安全分析测试

这些测试验证代码安全分析功能。

| 用例 ID | 说明 | 预期结果 |
|---------|------|----------|
| ANA-01 | 测试选区分析 | 应分析选中区域并显示结果 |
| ANA-02 | 测试无选区分析 | 应分析整个文件并显示结果 |
| ANA-03 | 测试 LLM 分析结果 | 分析应包含安全风险和修复建议 |

## 手动测试场景

以下是手动测试安全编码助手功能的场景：

### 场景 1: 验证基本安全检测功能

1. 在 VS Code 中打开一个 JavaScript 文件
2. 输入以下代码：
   ```javascript
   // 测试 SQL 注入检测
   const userId = req.body.userId;
   const query = "SELECT * FROM users WHERE id = " + userId;
   
   // 测试 XSS 检测
   const userInput = req.body.comment;
   document.getElementById('comment').innerHTML = userInput;
   
   // 测试敏感数据检测
   const apiKey = "sk_live_1234567890abcdef";
   console.log("Password:", userPassword);
   ```
3. **预期结果**: 扩展应标记并显示三个安全问题，每行代码对应的安全风险类型应正确

### 场景 2: 验证代码补全功能

1. 打开一个新的 JavaScript 文件
2. 开始输入以下代码，但在 `=` 后停止：
   ```javascript
   const validateInput = 
   ```
3. **预期结果**: 应显示类似以下的代码补全建议：
   - `(input) => { return input.replace(/[<>]/g, ''); }`
   - `(input) => { return !!input && typeof input === 'string'; }`
   - 其他安全相关的输入验证函数
4. 按 Tab 键接受一个建议，验证补全功能

### 场景 3: 验证代码安全分析功能

1. 打开含有以下代码的 JavaScript 文件：
   ```javascript
   function processUserData(req, res) {
     const userData = req.body;
     const query = `INSERT INTO users (name, email) VALUES ('${userData.name}', '${userData.email}')`;
     db.execute(query);
     
     const userHtml = `<div>${userData.bio}</div>`;
     res.send(`
       <html>
         <body>
           ${userHtml}
         </body>
       </html>
     `);
   }
   ```
2. 选择整个函数代码
3. 右键单击，选择 "分析代码安全性"
4. **预期结果**: 应打开新窗口，显示详细的安全分析，包括 SQL 注入和 XSS 风险的说明和修复建议

### 场景 4: 验证设置选项

1. 打开 VS Code 设置
2. 找到安全编码助手扩展的设置
3. 禁用 Ghost Text 功能
4. 打开 JavaScript 文件并开始编码
5. **预期结果**: 不应显示代码补全建议
6. 重新启用 Ghost Text 功能
7. **预期结果**: 代码补全建议应再次显示

## 测试环境需求

- VS Code v1.75.0+
- Node.js v14.0+
- 配置好的 OpenAI API 密钥（用于 LLM 相关测试）
- 确保所有依赖项已安装：`npm install`

## 问题报告

测试中发现的问题请在 GitHub Issues 中报告，包含以下信息：

1. 测试用例 ID 或场景描述
2. 预期行为
3. 实际行为
4. 环境信息（VS Code 版本、操作系统等）
5. 重现步骤
6. 截图或错误日志（如有）

## 持续集成

项目使用 GitHub Actions 进行持续集成，每次提交都会自动运行测试套件。

查看最新的测试结果：[GitHub Actions](https://github.com/your-repo/security-assistant/actions) 