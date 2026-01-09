import { Ollama, type Config } from "ollama";
import { Model } from "../node_modules/@strands-agents/sdk/dist/src/models/model";
import type { BaseModelConfig, StreamOptions } from "@strands-agents/sdk";
import type { Message } from "@strands-agents/sdk";
import type { ModelStreamEvent } from "@strands-agents/sdk";
import {
  ImageBlock,
  Logger,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
} from "@strands-agents/sdk";

/**
 * Default logger implementation.
 *
 * Only logs warnings and errors to console. Debug and info are no-ops.
 */
const defaultLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};

/**
 * Global logger instance.
 */
export let logger: Logger = defaultLogger;

/**
 * Configuration for Ollama model provider.
 */
export interface OllamaModelConfig extends BaseModelConfig {
  modelId: string;
  host?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  keepAlive?: string | number;
  options?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

/**
 * Ollama model provider implementation for Strands SDK.
 */
export class OllamaModel extends Model<OllamaModelConfig> {
  private _config: OllamaModelConfig;

  constructor(config: OllamaModelConfig) {
    super();
    this._config = config;
  }

  updateConfig(modelConfig: Partial<OllamaModelConfig>): void {
    this._config = { ...this._config, ...modelConfig };
  }

  getConfig(): OllamaModelConfig {
    return this._config;
  }

  /**
   * Formats the request for Ollama's chat API.
   */
  private _formatRequest(messages: Message[], options?: StreamOptions) {
    const systemPrompt = options?.systemPrompt;
    let formattedMessages: any[] = [];

    // Handle System Prompt
    if (systemPrompt) {
      const content =
        typeof systemPrompt === "string"
          ? systemPrompt
          : systemPrompt.map((b) => ("text" in b ? b.text : "")).join("");
      formattedMessages.push({ role: "system", content });
    }

    // Convert Strands Messages to Ollama format
    for (const msg of messages) {
      for (const block of msg.content) {
        if (block instanceof TextBlock) {
          formattedMessages.push({ role: msg.role, content: block.text });
        } else if (
          block instanceof ImageBlock &&
          block.source.type === "imageSourceBytes"
        ) {
          // Ollama expects base64 strings in an 'images' array
          formattedMessages.push({
            role: msg.role,
            images: [block.source.bytes],
          });
        } else if (block instanceof ToolUseBlock) {
          formattedMessages.push({
            role: msg.role,
            tool_calls: [
              {
                function: {
                  name: block.name,
                  arguments: block.input,
                },
              },
            ],
          });
        } else if (block instanceof ToolResultBlock) {
          // Flatten tool results into messages with role 'tool'
          for (const result of block.content) {
            formattedMessages.push({
              role: "tool",
              content:
                "json" in result ? JSON.stringify(result.json) : result.text,
            });
          }
        }
      }
    }

    return {
      model: this._config.modelId,
      messages: formattedMessages,
      stream: true,
      options: {
        temperature: this._config.temperature,
        num_predict: this._config.maxTokens,
        top_p: this._config.topP,
        stop: this._config.stopSequences,
        ...(this._config.options || {}),
      },
      keep_alive: this._config.keepAlive,
      tools: options?.toolSpecs?.map((spec) => ({
        type: "function",
        function: {
          name: spec.name,
          description: spec.description,
          parameters: spec.inputSchema,
        },
      })),
      ...(this._config.params || {}),
    };
  }

  async *stream(
    messages: Message[],
    options?: StreamOptions,
  ): AsyncIterable<ModelStreamEvent> {
    const request = this._formatRequest(messages, options);

    // Initialize Ollama client
    const client = new Ollama({ host: this._config.host });

    yield { type: "modelMessageStartEvent", role: "assistant" };

    try {
      const response = await client.chat(request as any);
      let toolRequested = false;

      for await (const chunk of response) {
        // Handle Text Content
        if (chunk.message?.content) {
          yield {
            type: "modelContentBlockDeltaEvent",
            delta: { type: "textDelta", text: chunk.message.content },
          };
        }

        if (chunk.message?.tool_calls) {
          for (const tc of chunk.message.tool_calls) {
            toolRequested = true;

            // 1. start the block
            yield {
              type: "modelContentBlockStartEvent",
              start: {
                type: "toolUseStart",
                toolUseId: `call_${Math.random().toString(36).substring(2, 9)}`,
                name: tc.function.name,
              },
            };

            // 2. send the delta (the arguments)
            yield {
              type: "modelContentBlockDeltaEvent",
              delta: {
                type: "toolUseInputDelta",
                input: JSON.stringify(tc.function.arguments),
              },
            };

            // 3. STOP the block (CRITICAL: The SDK needs to know this specific block is done)
            yield {
              type: "modelContentBlockStopEvent",
            };
          }
        }

        // Handle completion metadata
        if (chunk.done) {
          if (chunk.prompt_eval_count !== undefined) {
            yield {
              type: "modelMetadataEvent",
              usage: {
                inputTokens: chunk.prompt_eval_count,
                outputTokens: chunk.eval_count || 0,
                totalTokens:
                  (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0),
              },
            };
          }

          yield {
            type: "modelMessageStopEvent",
            stopReason: toolRequested ? "toolUse" : "endTurn",
          };
        }
      }
    } catch (error) {
      logger.error("Ollama Stream Error:", error);
      throw error;
    }
  }
}
