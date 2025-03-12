// SQL注入测试
function unsafeQuery(userId) {
    // 不安全：直接拼接SQL
    const query = "SELECT * FROM users WHERE id = " + userId;
    return executeQuery(query);
}

// XSS测试
function unsafeHtml(userInput) {
    // 不安全：直接设置innerHTML
    document.getElementById('output').innerHTML = userInput;
    return true;
}

// 敏感数据测试
function hardcodedCredentials() {
    // 不安全：硬编码API密钥
    const API_KEY = "sk_test_abcdefghijklmnopqrstuvwxyz123456";
    const dbPassword = "admin123";
    
    console.log("连接到API");
    return callApi(API_KEY);
}

// 模拟函数
function executeQuery(query) { return []; }
function callApi(key) { return { success: true }; } 