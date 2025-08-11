import { Command } from "commander";
import { DocstoreCommandOptions, createDocstoreClient } from "./index.js";
import { debugError, enableAllDebug } from "../../../common/debug.js";
import { createRagEmbeddings } from "../../../rag/index.js";

/**
 * Create a new docstore
 * @param name Name of the docstore
 * @param options Command options
 */
export async function createDocstore(
  name: string,
  options: DocstoreCommandOptions & {
    model?: string;
    model_options?: string;
  }
): Promise<void> {
  try {
    // Enable debug output if debug flag is set
    if (options.debug) {
      enableAllDebug();
    }
    
    // load embeddings to learn the vector size
    const embeddings = createRagEmbeddings(options.model);
    await embeddings.start();
    const vectorSize = await embeddings.getVectorSize();
    const model = embeddings.getModelName();

    const docstore = await createDocstoreClient(options);
    const docstoreId = await docstore.createDocstore(
      name,
      model,
      vectorSize,
      options.model_options || ""
    );
    console.log(`Docstore '${name}' created with ID: ${docstoreId}`);
    console.log(`Model: ${model}`);
    console.log(`Vector size: ${vectorSize}`);
    docstore[Symbol.dispose]();
  } catch (error) {
    debugError(`Error creating docstore: ${error}`);
    process.exit(1);
  }
}

/**
 * Register the create command
 * @param docstoreCommand The parent docstore command
 * @param addPathOption Function to add path option to command
 */
export function registerCreateCommand(
  docstoreCommand: Command,
  addCommonOptions: (cmd: Command) => Command
): void {
  const createCommand = docstoreCommand
    .command("create")
    .description("Create a new docstore")
    .argument("<name>", "Name of the docstore")
    .option("-m, --model <model>", "Embeddings model name")
    .option("-o, --model-options <options>", "Model options")
    .action(createDocstore);
  
  addCommonOptions(createCommand);
}