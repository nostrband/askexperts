/**
 * Utility functions and classes for experts
 */

import { ChatCompletion } from "openai/resources";
import { debugError, debugExpert } from "../../common/debug.js";
import { OpenaiInterface } from "../../openai/index.js";

export { Nostr } from "./Nostr.js";
export { parseExpertProfile } from "./Nostr.js";
export type { ModelPricing, PricingResult } from "./ModelPricing.js";
export { OpenRouter } from "./OpenRouter.js";


export async function extractHashtags(
  openai: OpenaiInterface,
  model: string,
  profile: any,
  posts: { content: string }[]
): Promise<string[]> {
  try {
    // Create system prompt for hashtag extraction
    const systemPrompt = `You are an expert at analyzing user profiles and determining what topics they are knowledgeable about.
Analyze the provided profile information and identify at least 10 hashtags that represent topics this person would be considered an expert on.
Focus on content of their posts, areas where they demonstrate knowledge.
Then for each hashtag, come up with 4 additional variations of it and add variations to the hashtag list too.
Return ONLY a JSON array of hashtags - english, lowercase, without # symbol, with - instead of spaces, with no explanation or other text.
Example response: ["bitcoin", "programming", "javascript", "webapps", "openprotocols"]`;

    const MAX_SIZE = 100000; // 100 kb
    let size = 0;
    const input_posts = [];
    while (posts.length > 0 && size < MAX_SIZE) {
      const post = posts.shift()!;
      if (size + post.content.length > MAX_SIZE)
        break;
      size += post.content.length;
      input_posts.push({ content: post.content });
    }

    const input = JSON.stringify(
      {
        profile: profile,
        posts: input_posts,
      },
      null,
      2
    );
    debugExpert(`Extract hashtags, input size ${input.length} chars`);

    // Make completion request
    const quote = await openai.getQuote(model, {
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: input,
        },
      ],
      temperature: 0.5,
    });
    debugExpert(`Paying ${quote.amountSats} for extractHashtags`);

    const completion = (await openai.execute(quote.quoteId)) as ChatCompletion;

    // Extract and parse the hashtags from the response
    const content = completion.choices[0]?.message?.content || "[]";

    // Try to parse the JSON array
    const hashtags = JSON.parse(content) as any[];
    return hashtags.filter((tag) => typeof tag === "string");
  } catch (error) {
    debugError("Error extracting hashtags:", error);
    throw error;
  }
}
