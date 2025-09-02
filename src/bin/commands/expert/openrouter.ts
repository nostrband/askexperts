import { Command } from "commander";
import { getOpenRouter } from "../../../experts/utils/OpenRouter.js";
import {
  debugError,
  debugExpert,
  enableAllDebug,
  enableErrorDebug,
} from "../../../common/debug.js";
import { generateRandomKeyPair } from "../../../common/crypto.js";
import { getPublicKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { DBExpert } from "../../../db/interfaces.js";
import { getWalletByNameOrDefault } from "../wallet/utils.js";
import { ExpertCommandOptions, addRemoteOptions } from "./index.js";
import { createDBClientForCommands } from "../utils.js";

/**
 * Options for the OpenRouter experts command
 */
export interface OpenRouterExpertsCommandOptions extends ExpertCommandOptions {
  margin: number;
  models?: string[];
  debug?: boolean;
  wallet?: string;
  user?: string;
}

/**
 * Manage OpenRouter experts in the database
 * Creates or updates experts for available models
 * Disables experts for unavailable models
 *
 * @param options Command line options
 */
export async function manageOpenRouterExperts(
  options: OpenRouterExpertsCommandOptions
): Promise<void> {
  // Enable debug if requested
  if (options.debug) enableAllDebug();
  else enableErrorDebug();

  try {
    // Get the expert client
    const db = await createDBClientForCommands(options);
    const user_id = await db.getUserId();

    const openRouter = getOpenRouter();

    // Get the list of models
    const models = await openRouter.list();
    debugExpert(`Found ${models.length} models from OpenRouter`);

    // Filter models if specific ones were requested
    let filteredModels = models;
    if (options.models && options.models.length > 0) {
      const modelSet = new Set(options.models);
      filteredModels = models.filter((model) => modelSet.has(model.id));
      debugExpert(`Filtered to ${filteredModels.length} requested models`);
    }

    // Get the wallet to use for experts
    const wallet = await getWalletByNameOrDefault(db, options.wallet);
    debugExpert(`Using wallet: ${wallet.name} (ID: ${wallet.id})`);

    // Get all existing OpenRouter experts from the database
    const allExperts = await db.listExperts();
    const openRouterExperts = allExperts.filter(
      (expert) => expert.type === "openrouter"
    );
    debugExpert(
      `Found ${openRouterExperts.length} existing OpenRouter experts in database`
    );

    // Create a map of existing experts by model ID
    const existingExpertsByModel = new Map<string, DBExpert>();
    for (const expert of openRouterExperts) {
      if (!expert.model) continue;
      existingExpertsByModel.set(expert.model, expert);
    }

    // Helper
    const createExpert = async (modelId: string) => {
      // Create new expert
      debugExpert(`Creating new expert for model ${modelId}`);

      // Generate keypair
      const { privateKey } = generateRandomKeyPair();
      const privkey = privateKey;
      const pubkey = getPublicKey(privkey);

      // Create expert object
      const expert: DBExpert = {
        user_id,
        pubkey,
        wallet_id: wallet.id,
        type: "openrouter",
        nickname: `openrouter_${modelId}`,
        env: "",
        docstores: "",
        privkey: bytesToHex(privkey),
        disabled: false,
        model: modelId,
        price_base: 0,
        price_margin: options.margin.toString(),
        description: "",
        picture: "",
        hashtags: "",
        discovery_hashtags: "",
        discovery_relays: "",
        prompt_relays: "",
        system_prompt: "",
        temperature: "",
      };

      // Insert into database
      await db.insertExpert(expert);
      debugExpert(`Created expert for model ${modelId} with pubkey ${pubkey}`);
    };

    // Create or update experts for each available model
    for (const model of filteredModels) {
      const modelId = model.id;
      try {
        debugExpert(`Processing model: ${modelId}`);

        // Check if the model is accessible
        const apiKey = process.env.OPENROUTER_API_KEY || "";
        const isModelAccessible = await openRouter.checkModel(modelId, apiKey);

        if (!isModelAccessible) {
          debugExpert(
            `Skipping model ${modelId} as it requires a provider API key or is not accessible`
          );

          // If we have an existing expert for this model, disable it
          const existingExpert = existingExpertsByModel.get(modelId);
          if (existingExpert && !existingExpert.disabled) {
            debugExpert(`Disabling expert for inaccessible model ${modelId}`);
            await db.setExpertDisabled(existingExpert.pubkey, true);
          }

          continue;
        }

        // Check if we already have an expert for this model
        const existingExpert = existingExpertsByModel.get(modelId);

        if (existingExpert) {
          // Update existing expert
          debugExpert(`Updating existing expert for model ${modelId}`);

          existingExpert.price_margin = options.margin.toString();
          existingExpert.disabled = false; // Ensure expert is enabled

          // Update in database
          await db.updateExpert(existingExpert);
          debugExpert(`Updated expert for model ${modelId}`);
        } else {
          await createExpert(modelId);
        }
      } catch (error) {
        debugError(`Error processing model ${modelId}: ${error}`);
      }
    }

    // Disable experts for models that are no longer available
    const availableModelIds = new Set(filteredModels.map((model) => model.id));
    for (const [modelId, expert] of existingExpertsByModel.entries()) {
      if (!availableModelIds.has(modelId)) {
        debugExpert(`Disabling expert for unavailable model ${modelId}`);
        await db.setExpertDisabled(expert.pubkey, true);
      }
    }

    // Set up hourly refresh
    const refreshInterval = 60 * 60 * 1000; // 1 hour

    const refreshExperts = async () => {
      try {
        debugExpert("Refreshing OpenRouter models...");

        // Fetch latest models
        await openRouter.update();
        const latestModels = await openRouter.list();

        // Filter models if specific ones were requested
        let latestFilteredModels = latestModels;
        if (options.models && options.models.length > 0) {
          const modelSet = new Set(options.models);
          latestFilteredModels = latestModels.filter((model) =>
            modelSet.has(model.id)
          );
        }

        // Get all existing OpenRouter experts from the database
        const currentExperts = (await db.listExperts()).filter(
          (expert) => expert.type === "openrouter"
        );

        // Create a map of existing experts by model ID
        const currentExpertsByModel = new Map<string, DBExpert>();
        for (const expert of currentExperts) {
          if (!expert.model) continue;
          currentExpertsByModel.set(expert.model, expert);
        }

        // Create or update experts for each available model
        for (const model of latestFilteredModels) {
          const modelId = model.id;
          try {
            // Check if the model is accessible
            const apiKey = process.env.OPENROUTER_API_KEY || "";
            const isModelAccessible = await openRouter.checkModel(
              modelId,
              apiKey
            );

            if (!isModelAccessible) {
              debugExpert(
                `Skipping model ${modelId} as it requires a provider API key or is not accessible`
              );

              // If we have an existing expert for this model, disable it
              const existingExpert = currentExpertsByModel.get(modelId);
              if (existingExpert && !existingExpert.disabled) {
                debugExpert(
                  `Disabling expert for inaccessible model ${modelId}`
                );
                await db.setExpertDisabled(existingExpert.pubkey, true);
              }

              continue;
            }

            // Check if we already have an expert for this model
            const existingExpert = currentExpertsByModel.get(modelId);

            if (existingExpert) {
              // Enable expert if it was disabled
              if (existingExpert.disabled) {
                debugExpert(`Re-enabling expert for model ${modelId}`);
                await db.setExpertDisabled(existingExpert.pubkey, false);
              }
            } else {
              await createExpert(modelId);
            }
          } catch (error) {
            debugError(`Error processing model ${modelId}: ${error}`);
          }
        }

        // Disable experts for models that are no longer available
        const availableModelIds = new Set(
          latestFilteredModels.map((model) => model.id)
        );
        for (const [modelId, expert] of currentExpertsByModel.entries()) {
          if (!availableModelIds.has(modelId)) {
            debugExpert(`Disabling expert for unavailable model ${modelId}`);
            await db.setExpertDisabled(expert.pubkey, true);
          }
        }

        debugExpert(
          `Refreshed experts: ${latestFilteredModels.length} active models`
        );
      } catch (error) {
        debugError(`Error refreshing experts: ${error}`);
      }
    };

    // Set up the interval
    const intervalId = setInterval(refreshExperts, refreshInterval);

    // Handle SIGINT/SIGTERM (Ctrl+C)
    const sigHandler = async () => {
      debugExpert("\nReceived SIGINT. Shutting down...");

      // Clear the interval
      clearInterval(intervalId);

      debugExpert("Shutdown complete.");
      process.exit(0);
    };

    process.on("SIGINT", sigHandler);
    process.on("SIGTERM", sigHandler);

    debugExpert(
      `Managed ${filteredModels.length} OpenRouter experts with margin ${options.margin}`
    );
    debugExpert("Press Ctrl+C to exit.");
  } catch (error) {
    debugError("Error managing OpenRouter experts:", error);
    throw error;
  }
}

/**
 * Register the OpenRouter experts command with the CLI
 * Can be used as a standalone command or as a subcommand
 *
 * @param program The commander program or parent command
 */
export function registerOpenRouterCommand(program: Command): void {
  const command = program
    .command("openrouter")
    .description(
      "Manage experts for OpenRouter models in the database. Creates or updates experts for available models and disables experts for unavailable models."
    )
    .requiredOption(
      "-m, --margin <number>",
      "Profit margin (e.g., 0.1 for 10%)",
      parseFloat
    )
    .option(
      "--models <items>",
      "Comma-separated list of specific models to manage",
      (value: string) => value.split(",").map((item) => item.trim())
    )
    .option(
      "-w, --wallet <name>",
      "Wallet name to use (uses default if not provided)"
    )
    .option(
      "--user <user_id>",
      "User ID to connect as (uses current user if not provided)"
    )
    .option("-d, --debug", "Enable debug logging")
    .action(async (options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        await manageOpenRouterExperts(options);
      } catch (error) {
        debugError("Error managing OpenRouter experts:", error);
        process.exit(1);
      }
    });

  // Add remote options
  addRemoteOptions(command);
}
