/**
 * Interface for AskExpertsServer class
 * Extends AskExpertsServerBaseInterface with payment-related methods
 */

import { AskExpertsServerBaseInterface } from "./AskExpertsServerBaseInterface.js";
import { OnPromptPriceCallback, OnPromptPaidCallback } from "../common/types.js";

export interface AskExpertsServerInterface extends AskExpertsServerBaseInterface {
  /**
   * Callback for determining prompt prices
   */
  get onPromptPrice(): OnPromptPriceCallback | undefined;
  set onPromptPrice(value: OnPromptPriceCallback | undefined);

  /**
   * Callback for handling paid prompts
   */
  get onPromptPaid(): OnPromptPaidCallback | undefined;
  set onPromptPaid(value: OnPromptPaidCallback | undefined);
}