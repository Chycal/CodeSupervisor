export interface SecurityIssue {
  id?: string;
  message: string;
  severity: "critical" | "high" | "medium" | "low";
  line: number;
  column: number;
  rule?: string;
  code?: string;
  filename: string;
  source?: string;  // 诊断来源，例如 "CodeSupervisior"
}

export interface AnalysisResult {
  issues: SecurityIssue[];
}
