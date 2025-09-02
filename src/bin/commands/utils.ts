import { createDBClient } from "../../db/utils.js";

export async function createDBClientForCommands(options: {
  remote?: boolean;
  url?: string;
  user?: string;
}) {
  const url = options.remote
    ? options.url || "https://api.askexperts.io"
    : undefined;
  return createDBClient(url, options.user);
}
