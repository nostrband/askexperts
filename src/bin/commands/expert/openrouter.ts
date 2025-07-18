import { SimplePool } from "nostr-tools";
import { OpenaiExpert } from "../../../experts/OpenaiExpert.js";
import { OpenRouter } from "../../../experts/utils/OpenRouter.js";
import { debugError, debugExpert, enableAllDebug, enableErrorDebug } from "../../../common/debug.js";
import { generateRandomKeyPair } from "../../../common/crypto.js";
import { createWallet } from "nwc-enclaved-utils";
import fs from "fs";
import path from "path";
import { Command } from "commander";

/**
 * Options for the OpenRouter experts command
 */
export interface OpenRouterExpertsCommandOptions {
  margin: number;
  models?: string[];
  debug?: boolean;
  apiKey?: string;
}

/**
 * Expert configuration stored in JSON file
 */
interface ExpertConfig {
  experts: {
    model: string;
    privkeyHex: string;
    nwcString: string;
  }[];
}

/**
 * Start OpenRouter experts with the given options
 *
 * @param options Command line options
 */
export async function startOpenRouterExperts(
  options: OpenRouterExpertsCommandOptions
): Promise<void> {
  // Enable debug if requested
  if (options.debug) enableAllDebug();
  else enableErrorDebug();

  try {
    // Create a shared pool for all experts
    const pool = new SimplePool();

    // Create OpenRouter instance for pricing
    const openRouter = new OpenRouter();

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

    // Load or create the configuration file
    const configPath = path.resolve("openrouter_experts.json");
    let config: ExpertConfig = { experts: [] };
    
    if (fs.existsSync(configPath)) {
      try {
        const configData = fs.readFileSync(configPath, "utf8");
        config = JSON.parse(configData);
        debugExpert(`Loaded configuration for ${config.experts.length} experts`);
      } catch (error) {
        debugError(`Error loading configuration: ${error}`);
        config = { experts: [] };
      }
    }

    // Create a map of existing experts by model ID
    const existingExperts = new Map<string, {
      privkeyHex: string;
      nwcString: string;
    }>();
    
    for (const expert of config.experts) {
      existingExperts.set(expert.model, {
        privkeyHex: expert.privkeyHex,
        nwcString: expert.nwcString
      });
    }

    // Create experts for each model
    const activeExperts: OpenaiExpert[] = [];
    const updatedConfig: ExpertConfig = { experts: [] };

    const launch = async (modelId: string) => {
      try {
        let privkey: Uint8Array;
        let nwcString: string;
        
        // Check if we already have configuration for this model
        const existingExpert = existingExperts.get(modelId);
        
        if (existingExpert) {
          // Use existing configuration
          privkey = new Uint8Array(Buffer.from(existingExpert.privkeyHex, "hex"));
          nwcString = existingExpert.nwcString;
          debugExpert(`Using existing configuration for model ${modelId}`);
        } else {
          // Generate new keypair
          const { privateKey } = generateRandomKeyPair();
          privkey = privateKey;
          
          // Create new wallet
          debugExpert(`Creating new wallet for model ${modelId}`);
          const wallet = await createWallet();
          nwcString = wallet.nwcString;
          
          debugExpert(`Created new configuration for model ${modelId}`);
        }
        
        // Create the expert
        const expert = new OpenaiExpert({
          privkey,
          openaiBaseUrl: "https://openrouter.ai/api/v1",
          openaiApiKey: options.apiKey || process.env.OPENROUTER_API_KEY || "",
          model: modelId,
          nwcString,
          margin: options.margin,
          pricingProvider: openRouter,
          pool
        });
        
        // Start the expert
        await expert.start();
        activeExperts.push(expert);
        
        // Add to updated configuration
        updatedConfig.experts.push({
          model: modelId,
          privkeyHex: Buffer.from(privkey).toString("hex"),
          nwcString
        });
        
        debugExpert(`Started expert for model ${modelId}`);
      } catch (error) {
        debugError(`Error creating expert for model ${modelId}: ${error}`);
      }
    };

    // Launch the models
    for (const model of filteredModels) {
      await launch(model.id);
    }

    // Save the updated configuration
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
    debugExpert(`Saved configuration for ${updatedConfig.experts.length} experts`);
    
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
          latestFilteredModels = latestModels.filter((model) => modelSet.has(model.id));
        }
        
        // Get current model IDs
        const currentModelIds = new Set(activeExperts.map((expert) => expert.getModel()));
        
        // Find new models to add
        for (const model of latestFilteredModels) {
          if (!currentModelIds.has(model.id)) {
            debugExpert(`Added model ${model.id}`);
            await launch(model.id);
          }
        }
        
        // Find models to remove
        const latestModelIds = new Set(latestFilteredModels.map((model) => model.id));
        const expertsToRemove: OpenaiExpert[] = [];
        
        for (const expert of activeExperts) {
          const modelId = expert.getModel();
          if (!latestModelIds.has(modelId)) {
            expertsToRemove.push(expert);
          }
        }
        
        // Remove experts for models that no longer exist
        for (const expert of expertsToRemove) {
          const modelId = expert.getModel();
          debugExpert(`Shutting down expert for removed model ${modelId}`);
          
          // Dispose of the expert
          expert[Symbol.dispose]();
          
          // Remove from active experts
          const index = activeExperts.indexOf(expert);
          if (index !== -1) {
            activeExperts.splice(index, 1);
          }
          
          // Remove from configuration
          const configIndex = updatedConfig.experts.findIndex(e => e.model === modelId);
          if (configIndex !== -1) {
            updatedConfig.experts.splice(configIndex, 1);
          }
        }
        
        // Save the updated configuration
        fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));
        debugExpert(`Refreshed experts: ${activeExperts.length} active`);
      } catch (error) {
        debugError(`Error refreshing experts: ${error}`);
      }
    };
    
    // Set up the interval
    const intervalId = setInterval(refreshExperts, refreshInterval);
    
    // Handle SIGINT/SIGTERM (Ctrl+C)
    const sigHandler = async () => {
      debugExpert("\nReceived SIGINT. Shutting down experts...");
      
      // Clear the interval
      clearInterval(intervalId);
      
      // Dispose of all experts
      for (const expert of activeExperts) {
        expert[Symbol.dispose]();
      }
      
      debugExpert("All experts shut down.");
      process.exit(0);
    };
    
    process.on("SIGINT", sigHandler);
    process.on("SIGTERM", sigHandler);
    
    debugExpert(`Started ${activeExperts.length} OpenRouter experts with margin ${options.margin}`);
    debugExpert("Press Ctrl+C to exit.");
  } catch (error) {
    debugError("Error starting OpenRouter experts:", error);
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
  program
    .command("openrouter")
    .description("Launch experts for OpenRouter models. Expert settings are saved to openrouter_experts.json file.")
    .requiredOption("-m, --margin <number>", "Profit margin (e.g., 0.1 for 10%)", parseFloat)
    .option(
      "--models <items>",
      "Comma-separated list of specific models to launch",
      (value: string) => value.split(",").map((item) => item.trim())
    )
    .option("-k, --api-key <key>", "OpenRouter API key (defaults to OPENROUTER_API_KEY env var)")
    .option("-d, --debug", "Enable debug logging")
    .action(async (options) => {
      if (options.debug) enableAllDebug();
      else enableErrorDebug();
      try {
        await startOpenRouterExperts(options);
      } catch (error) {
        debugError("Error starting OpenRouter experts:", error);
        process.exit(1);
      }
    });
}