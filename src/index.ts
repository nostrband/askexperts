// Enable debug if DEBUG environment variable is set
if (process.env.DEBUG) {
  const { enableAllDebug } = require('./common/debug.js');
  enableAllDebug();
}

// Export the AskExpertsMCP class (new implementation that extends McpServer)
export { AskExpertsMCP, BidMCP, ReplyMCP } from "./mcp/AskExpertsMCP.js";

// Export the OpenAIProxy class
export { OpenAIProxy } from "./proxy/index.js";

// Export debug utilities
export {
  debugRelay,
  debugMCP,
  debugExpert,
  debugClient,
  debugError,
  enableAllDebug,
  disableAllDebug
} from "./common/debug.js";

// Export the LightningPaymentManager
export { LightningPaymentManager } from "./lightning/LightningPaymentManager.js";

// Export the Expert class
export { AskExpertsServer } from "./expert/index.js";

// Export common types for convenience
export type {
  Ask,
  Prompt,
  Quote,
  Proof,
  Reply,
  Replies,
  PromptFormat,
  CompressionMethod,
  PaymentMethod
} from "./common/types.js";
