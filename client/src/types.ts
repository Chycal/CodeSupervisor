export interface SecurityIssue {
  id?: string;
  message: string;
  severity: "critical" | "high" | "medium" | "low";
  line: number;
  column: number;
  rule?: string;
  code?: string;
  filename: string;
}

export interface AnalysisResult {
  issues: SecurityIssue[];
}
