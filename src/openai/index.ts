import { APIPromise, OpenAI } from "openai";
import {
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionCreateParamsBase,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";

/**
 * Interface that matches the OpenAI chat completions API
 * This allows for dependency injection and easier testing
 */
export interface OpenaiInterface {
  chat: {
    completions: {
      create(
        body: ChatCompletionCreateParamsNonStreaming,
        options?: any
      ): APIPromise<ChatCompletion>;
      create(
        body: ChatCompletionCreateParamsStreaming,
        options?: any
      ): APIPromise<AsyncIterable<ChatCompletionChunk>>;
      create(
        body: ChatCompletionCreateParamsBase,
        options?: any
      ): APIPromise<AsyncIterable<ChatCompletionChunk> | ChatCompletion>;
      create(
        body: ChatCompletionCreateParams,
        options?: any
      ):
        | APIPromise<ChatCompletion>
        | APIPromise<AsyncIterable<ChatCompletionChunk>>;
    };
  };
}

/**
 * Creates an OpenAI instance that implements OpenaiInterface
 *
 * @param apiKey - OpenAI API key
 * @param baseURL - OpenAI base URL
 * @param defaultHeaders - Optional default headers
 * @returns OpenAI instance implementing OpenaiInterface
 */
export function createOpenAI(
  apiKey: string,
  baseURL: string,
  defaultHeaders?: Record<string, string>
): OpenaiInterface {
  return new OpenAI({
    apiKey,
    baseURL,
    defaultHeaders,
  });
}
