import type { TaskPayload, Usage } from "../types";

export type ProviderCallOptions = {
  streamCallback?: (chunk: string) => void;
  cancelSignal?: AbortSignal;
};

export type ProviderResult = {
  text: string;
  usage: Usage;
  thinking: string;
  provider_state?: Record<string, unknown>;
};

export abstract class Provider {
  abstract call(system: string, task: TaskPayload, opts?: ProviderCallOptions): Promise<ProviderResult>;
  abstract validate(): Promise<{ ok: boolean; message: string }>;
  protected flattenContent(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object") {
            return part.text || part.content || JSON.stringify(part);
          }
          return String(part);
        })
        .join("\n");
    }
    return String(content || "");
  }
}
