import { Command } from "commander";
import { getOpenRouter } from "../../../experts/utils/OpenRouter.js";
import {
  debugError,
  debugExpert,
  enableAllDebug,
  enableErrorDebug,
} from "../../../common/debug.js";
import { getWalletClient } from "../../../wallet/index.js";
import { generateRandomKeyPair } from "../../../common/crypto.js";
import { getPublicKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";
import { DBExpert } from "../../../db/interfaces.js";
import { getWalletByNameOrDefault } from "../wallet/utils.js";
import { ExpertCommandOptions, createExpertClient, addRemoteOptions } from "./index.js";

/**
 * Options for the OpenRouter experts command
 */
export interface OpenRouterExpertsCommandOptions extends ExpertCommandOptions {
  margin: number;
  models?: string[];
  debug?: boolean;
  wallet?: string;
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
    const expertClient = createExpertClient(options);

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
    const wallet = await getWalletByNameOrDefault(options.wallet);
    debugExpert(`Using wallet: ${wallet.name} (ID: ${wallet.id})`);

    // Get all existing OpenRouter experts from the database
    const allExperts = await expertClient.listExperts();
    const openRouterExperts = allExperts.filter(
      (expert) => expert.type === "openrouter"
    );
    debugExpert(
      `Found ${openRouterExperts.length} existing OpenRouter experts in database`
    );

    // Create a map of existing experts by model ID
    const existingExpertsByModel = new Map<string, DBExpert>();
    for (const expert of openRouterExperts) {
      // Extract model from env (format: EXPERT_MODEL=model\nEXPERT_MARGIN=margin)
      const envLines = expert.env.split("\n");
      const modelLine = envLines.find((line) =>
        line.startsWith("EXPERT_MODEL=")
      );
      if (modelLine) {
        const model = modelLine.substring("EXPERT_MODEL=".length);
        existingExpertsByModel.set(model, expert);
      }
    }

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
            await expertClient.setExpertDisabled(existingExpert.pubkey, true);
          }

          continue;
        }

        // Check if we already have an expert for this model
        const existingExpert = existingExpertsByModel.get(modelId);

        if (existingExpert) {
          // Update existing expert
          debugExpert(`Updating existing expert for model ${modelId}`);

          // Update environment variables with current margin
          const envLines = existingExpert.env.split("\n");
          const updatedEnvLines = envLines.map((line) => {
            if (line.startsWith("EXPERT_MARGIN=")) {
              return `EXPERT_MARGIN=${options.margin}`;
            }
            return line;
          });

          existingExpert.env = updatedEnvLines.join("\n");
          existingExpert.disabled = false; // Ensure expert is enabled

          // Update in database
          await expertClient.updateExpert(existingExpert);
          debugExpert(`Updated expert for model ${modelId}`);
        } else {
          // Create new expert
          debugExpert(`Creating new expert for model ${modelId}`);

          // Generate keypair
          const { privateKey } = generateRandomKeyPair();
          const privkey = privateKey;
          const pubkey = getPublicKey(privkey);

          // Create environment variables
          const env = `EXPERT_MODEL=${modelId}\nEXPERT_MARGIN=${options.margin}`;

          // Create expert object
          const expert: DBExpert = {
            pubkey,
            wallet_id: wallet.id,
            type: "openrouter",
            nickname: `openrouter_${modelId}`,
            env,
            docstores: "",
            privkey: bytesToHex(privkey),
            disabled: false,
          };

          // Insert into database
          await expertClient.insertExpert(expert);
          debugExpert(
            `Created expert for model ${modelId} with pubkey ${pubkey}`
          );
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
        await expertClient.setExpertDisabled(expert.pubkey, true);
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
        const currentExperts = (await expertClient.listExperts()).filter(
          (expert) => expert.type === "openrouter"
        );

        // Create a map of existing experts by model ID
        const currentExpertsByModel = new Map<string, DBExpert>();
        for (const expert of currentExperts) {
          const envLines = expert.env.split("\n");
          const modelLine = envLines.find((line) =>
            line.startsWith("EXPERT_MODEL=")
          );
          if (modelLine) {
            const model = modelLine.substring("EXPERT_MODEL=".length);
            currentExpertsByModel.set(model, expert);
          }
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
                await expertClient.setExpertDisabled(
                  existingExpert.pubkey,
                  true
                );
              }

              continue;
            }

            // Check if we already have an expert for this model
            const existingExpert = currentExpertsByModel.get(modelId);

            if (existingExpert) {
              // Enable expert if it was disabled
              if (existingExpert.disabled) {
                debugExpert(`Re-enabling expert for model ${modelId}`);
                await expertClient.setExpertDisabled(
                  existingExpert.pubkey,
                  false
                );
              }
            } else {
              // Create new expert
              debugExpert(`Creating new expert for model ${modelId}`);

              // Generate keypair
              const { privateKey } = generateRandomKeyPair();
              const privkey = privateKey;
              const pubkey = getPublicKey(privkey);

              // Create environment variables
              const env = `EXPERT_MODEL=${modelId}\nEXPERT_MARGIN=${options.margin}`;

              // Create expert object
              const expert: DBExpert = {
                pubkey,
                wallet_id: wallet.id,
                type: "openrouter",
                nickname: `openrouter_${modelId}`,
                env,
                docstores: "",
                privkey: bytesToHex(privkey),
                disabled: false,
              };

              // Insert into database
              await expertClient.insertExpert(expert);
              debugExpert(
                `Created expert for model ${modelId} with pubkey ${pubkey}`
              );
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
            await expertClient.setExpertDisabled(expert.pubkey, true);
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
