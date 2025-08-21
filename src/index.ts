// Enable debug if DEBUG environment variable is set
if (process.env.DEBUG) {
  const { enableAllDebug } = require('./common/debug.js');
  enableAllDebug();
}

// Export the AskExpertsMCP class (new implementation that extends McpServer)
export { AskExpertsMCP } from "./mcp/AskExpertsMCP.js";
export type { BidMCP, ReplyMCP } from "./mcp/AskExpertsMCP.js";

// Export the OpenAIProxy class
export { OpenaiProxy } from "./proxy/index.js";

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
export { LightningPaymentManager } from "./payments/LightningPaymentManager.js";

// Export the Expert class
export { AskExpertsServer } from "./server/index.js";

// Export common types for convenience
export type {
  Ask,
  Prompt,
  Quote,
  Proof,
  Reply,
  Replies,
  PromptFormat,
  PaymentMethod,
  ExpertPrice,
  OnPromptPriceCallback,
  OnPromptPaidCallback
} from "./common/types.js";

// Export the common module
export * from "./common/index.js";

// Export the experts module
export * from "./experts/index.js";
