type WebMcpJsonSchema = Record<string, unknown>;

type WebMcpTool = {
  name: string;
  description: string;
  inputSchema: WebMcpJsonSchema;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  execute: (input: unknown) => unknown | Promise<unknown>;
};

interface ModelContext {
  registerTool: (tool: WebMcpTool) => void | Promise<void>;
  unregisterTool?: (name: string) => void | Promise<void>;
}

interface Document {
  modelContext?: ModelContext;
}
