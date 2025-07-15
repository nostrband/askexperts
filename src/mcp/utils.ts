import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function makeTool<
  ParamsType,
  ExtraType,
  ResponseType extends { [x: string]: unknown }
>(callback: (params: ParamsType, extra: ExtraType) => Promise<ResponseType>) {
  return async (
    params: ParamsType,
    extra: ExtraType
  ): Promise<CallToolResult> => {
    let responseJson: ResponseType | { error: string };
    let isError = false;
    try {
      // Call the tool
      responseJson = await callback(params, extra);
    } catch (error) {
      isError = true;
      responseJson = {
        error: error instanceof Error ? error.message : String(error),
      };
    }

    // Return in the format expected by MCP
    return {
      isError,
      content: [
        {
          type: "text",
          text: JSON.stringify(responseJson, null, 2),
        },
      ],
      structuredContent: responseJson,
    };
  };
}
