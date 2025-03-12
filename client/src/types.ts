export interface SecurityIssue {
  message: string;
  severity: "critical" | "high" | "medium" | "low";
  line: number;
  column: number;
  rule: string;
  filename:string;
}

export interface AnalysisResult {
  issues: SecurityIssue[];
}
