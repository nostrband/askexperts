import { APIPromise } from "openai";
import {
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionChunk,
} from "openai/resources/chat/completions";
import { OpenaiInterface } from "./index.js";
import { PricingResult } from "../experts/utils/ModelPricing.js";
import { Prompt, Quote, Proof, Replies, Reply } from "../common/types.js";
import { AskExpertsClient } from "../client/AskExpertsClient.js";
import { LightningPaymentManager } from "../payments/LightningPaymentManager.js";
import { SimplePool } from "nostr-tools";
import { parseBolt11 } from "../common/bolt11.js";
import { METHOD_LIGHTNING, FORMAT_OPENAI } from "../common/constants.js";
import { debugError } from "../common/debug.js";

/**
 * OpenAI interface implementation that uses AskExperts
 * Provides a bridge between OpenAI API and AskExperts protocol
 */
export class OpenaiAskExperts implements OpenaiInterface {
  /**
   * Fixed fee in satoshis added to each transaction
   */
  static readonly FEES = 6;

  /**
   * Static mapping of aliases to expert pubkeys
   * When an alias is provided as the model, the corresponding pubkey will be used
   */
  static readonly EXPERT_ALIASES: Record<string, string> = {
    "qwen/qwen3-235b-a22b-thinking-2507":
      "10f3c1d0434c7bef9985fc70a2999d24ea0515e9f8b99675375d4273cb201b5f",
    "z-ai/glm-4-32b":
      "b0d4dde4a2d56d4287ffa09037ed04747c3803dac90f113241e2b60fd3e229eb",
    "qwen/qwen3-coder:free":
      "82966176025724dead6eb01debd37457350507368cda723b23e9102ba4ec36aa",
    "qwen/qwen3-coder":
      "3c2e9278119e5e0dfbd0a9f3724e1a6d27019898ee5c38ff475c2cf944382d04",
    "bytedance/ui-tars-1.5-7b":
      "606e941f601adb1a5750d587ad6ce9865239e8b8f39f738ca4d1709d23c6cb81",
    "google/gemini-2.5-flash-lite":
      "e8b0033b5ed729574e423b3a5a48fcb90aa565dab150b4f94fe4b7124b0bb84b",
    "qwen/qwen3-235b-a22b-2507:free":
      "4d3c5f46c6c4af3eb237ec517660ef6e60f8e2408e974d13a52153eee330f243",
    "qwen/qwen3-235b-a22b-2507":
      "05f750e5b421c132c693f293ac6222402f11f4617411d25e201a359828821c0d",
    "switchpoint/router":
      "739dc05adf1e3e139dd3d94c1e50e5295c7a12bec288b3ff2eee43d43d7c4eda",
    "moonshotai/kimi-k2:free":
      "560b00bbd0ec9944a6bd69c0bfc4aa29c7e28b9da6dc8f56c36b9c1bb3bada95",
    "moonshotai/kimi-k2":
      "b2c348289cf47526acb74d6bd03522be80850d8280b1447eb0e8a55ac2644306",
    "thudm/glm-4.1v-9b-thinking":
      "ebe2210396d2a0cf3145892eac69cbc8478669250e35d1d52f618c49f649e42b",
    "mistralai/devstral-medium":
      "688569880ec1fd0e2acf29a6ef5405adab04ecfbb1955cb56f35033af7e2841b",
    "mistralai/devstral-small":
      "56b3e064396acc3f2838758c6fd52d7d88f859b81041fea477b016b33dd8506b",
    "x-ai/grok-4":
      "41541ec2684f23ccfbffb7c4fdd76cc63e19fa3db2c037245a92be6b57b0be24",
    "google/gemma-3n-e2b-it:free":
      "9ff264ff9da410730360599f631fcba02127d9b269f3be91bdc2a6f90f38294c",
    "tencent/hunyuan-a13b-instruct:free":
      "59cd88d6a4c6c2e4dd902d4d00858288499b9db5fa8cabd01ade3601e515034f",
    "tngtech/deepseek-r1t2-chimera:free":
      "f7d355c0657a12f42bb77b5a122423cc87995e6c374b585c1ef5ceb26a5c90ca",
    "morph/morph-v3-large":
      "89f07afab2886bdc553b1d1bc4d0e23e5218a98b6f01d9317191999c7b363c4a",
    "morph/morph-v3-fast":
      "3583eed7212eee479a3491aae3a32289f96c91163dfb3fa4dd6fe011876d6b20",
    "baidu/ernie-4.5-300b-a47b":
      "fdfd7f80d23b9b7dda4e3d584239583dd97f6fca9903a8773017e7c6572a99d2",
    "thedrummer/anubis-70b-v1.1":
      "1d83750097afac0fe8a2d4b1e521651f162d3bb292961aca68b362ffee2a83c4",
    "inception/mercury":
      "e756b0ee6b8a9384e2213ef086f83f99d439fb2e925fb3189fce024ab4d3a486",
    "morph/morph-v2":
      "b624dbd8304f6c11621fef9d27a006628bac11357a9ec44691e0ff01501b5a54",
    "mistralai/mistral-small-3.2-24b-instruct:free":
      "4f81476eb796708b99b44883d03c219b4bec84287ff2953392c8947f2266afc0",
    "mistralai/mistral-small-3.2-24b-instruct":
      "2d09e1182d942db135500b59e1dd0f5172ef86fafe676f4d113bad8e1124f488",
    "minimax/minimax-m1":
      "81178804bc04ae5c7afc4e0cbc258b13e74783498a7f817fd632aaf130e7caa8",
    "google/gemini-2.5-flash-lite-preview-06-17":
      "3c8f41f63c891644ff7162cfd20139d224208e032fb0719db664c65a77343147",
    "google/gemini-2.5-flash":
      "a2ef11fd36478e754ec26dc2323e605e75383bb5fc79d9dfce6d59243f80ea19",
    "google/gemini-2.5-pro":
      "0c68de7fd9cd3641d08de070ee7cc538a74b5a00e0628a5db8ad6b1b3d7460c7",
    "moonshotai/kimi-dev-72b:free":
      "38cba06092022f64fd1051383b23219ec9f1c7376e20acefc6e3764ce5772838",
    "x-ai/grok-3-mini":
      "e12003d8c7768c63d935530a00e00f3ca6fa22afb09a094c44d976f461841ac5",
    "x-ai/grok-3":
      "3dcb0e8a2b388a1baf29df79e67ff8aad5c95f3e400f12ab93e89dc4cafb9df3",
    "mistralai/magistral-small-2506":
      "0891a78080e1f135cd31eff3f8013abf925c0cfaa171587f643479011250b7a4",
    "mistralai/magistral-medium-2506":
      "6306f4479e72c19425a309df121e1cdc7f92be526034333039342d352eca7968",
    "mistralai/magistral-medium-2506:thinking":
      "917662303c137be37c5cad240e7968afb333ce5c9638662a3e5099dcf310cc8c",
    "google/gemini-2.5-pro-preview":
      "8a1e12831eebea55d7983ba3bb53410a4a10cc7d27162fef6be714379294ecee",
    "deepseek/deepseek-r1-distill-qwen-7b":
      "70e7c90b9b2c74524a3683eec82d753dee51cd94cc478278870808d0389b031a",
    "deepseek/deepseek-r1-0528-qwen3-8b:free":
      "0425e050aaace3dececbd2aae997d0d95e35ff128a5d5af6032f8f2605963622",
    "deepseek/deepseek-r1-0528-qwen3-8b":
      "e4168c3559b4b7b084b0470d7e283882322c8836fc293ca3b125e5fbb0446cd3",
    "deepseek/deepseek-r1-0528:free":
      "9522421966aeca13617bc52f6a6da489180c37794c12d3819d9dcd3d11859214",
    "deepseek/deepseek-r1-0528":
      "16b03236a5cb7aa23ddec24ac0b1b37d5f105ebf162eeb3fae1b284696440005",
    "sarvamai/sarvam-m:free":
      "d58b8a539a406f4bfcdae71d82e4b8a5192ff76f0b9992c2325be4f66bfde948",
    "thedrummer/valkyrie-49b-v1":
      "62045e818cc373b717e5644a3ca985970e471852d7ea488f512fc1307cb79f90",
    "anthropic/claude-opus-4":
      "aee10aedb62ee6361b4127fb26314ed7f81cbbf0e806f03e967ca608822feed2",
    "anthropic/claude-sonnet-4":
      "74c68f6036d0a6ab369425b8b9d348932d3d51dd7ee39edb2cb09c570ae93182",
    "mistralai/devstral-small-2505:free":
      "9250fdc0906615bfcbe624459e869a26bb7ff683d3ca6c8dc3f5462a72f3d840",
    "mistralai/devstral-small-2505":
      "0edd14d518610f145017622aab06ce8292c3d382c251c8f3812996d5b556ba43",
    "google/gemma-3n-e4b-it:free":
      "0b7837ec91194d1c65fb086868ba93d523c98c15724c6402a5e5052eb8b270f0",
    "google/gemma-3n-e4b-it":
      "3eafedf3f6b379cce2e6b147499cb3dec1f7ef6d8d915320cbec5b86d86666fc",
    "mistralai/mistral-medium-3":
      "dd78f6f71098c1028e725e01d8f7d5315db922dc72cd8530693a81918c949d82",
    "google/gemini-2.5-pro-preview-05-06":
      "d4c165f409e68d33501a4462fa69bbcf156476cdf41f8b240a5d22d12b1550a9",
    "arcee-ai/spotlight":
      "f9c9dff997b39b9f3ab91a7294ac3e7e10fc7b087c2a41e7ed25ef6493ea0662",
    "arcee-ai/maestro-reasoning":
      "f5c1f26cb788c8838e6c45329ed347208a25e1dd2beb34c882e37f0c9fdff688",
    "arcee-ai/virtuoso-large":
      "a0abd38b0f9428add39d412812774cc14480b8e84a42908faa5ea77e7c6fba60",
    "arcee-ai/coder-large":
      "4da4e0d606d1ef63330d2361279c6671e5e9deec5e038df38a0674dff0a68fa3",
    "microsoft/phi-4-reasoning-plus":
      "79cab07c64a5d3850d07e9aedb785400f46aa2c566d2016833cfe8682ca492e8",
    "inception/mercury-coder":
      "6e61452c73bb7fdc0a1e509e7b9fa0489549e00651516b044c7752af8fd3b91d",
    "qwen/qwen3-4b:free":
      "b598f39f5ebc578e23ec24c8c24fa70281bde10b5d4aba5a5d9acab078c548df",
    "deepseek/deepseek-prover-v2":
      "15f052ad059c58ca738a8f1d4f73b82640328a81e28f9bee0e70d443da2ee229",
    "meta-llama/llama-guard-4-12b":
      "206c5ee61d9c4c6c9f15ad3f13a861d4bb8fb75a01a75dc5da8fd37986aef24a",
    "qwen/qwen3-30b-a3b:free":
      "b52178b3df0a310bc56716a7dd1ed5d153bf9a493ed7e679ae7f6bd77d9c160f",
    "qwen/qwen3-30b-a3b":
      "9e7b2fea31b30a70b1928259fc1c88c40a9eda6ffedc334379f0759af6380ed3",
    "qwen/qwen3-8b:free":
      "3a9eae6e7eaed327a18eb0f51b47b231823f7577d4c7b377b5e5b27e9d913efa",
    "qwen/qwen3-8b":
      "6da59a5137ba39660e36bda5c47248fb0e95b459b7ca00861daf8254bc78b27d",
    "qwen/qwen3-14b:free":
      "b60164261517c7a59a073c828e96480c3f8199e52d551d0f62a408bd0f2b4cf5",
    "qwen/qwen3-14b":
      "a642d06b21c896151a27b5df6826b0f05659aeb71372cd3ce9e4b9c0a0972cc4",
    "qwen/qwen3-32b":
      "9d3b8620b2ac6b87bb2881d204447c8b609f72b791f6ce280358148cc54ae7ef",
    "qwen/qwen3-235b-a22b:free":
      "4c35841f480e4e779bab5c2827cda58a9947620c5f112192c1f7b47450f7b99c",
    "qwen/qwen3-235b-a22b":
      "a69d760e1f3ebf04322f7d9e2df225009e28f81d7287e00809f4ce305c05989f",
    "tngtech/deepseek-r1t-chimera:free":
      "258da0a7a32fbff9c3317d05be7926c53c8607bc1da922ebccb23094e7eb1f1d",
    "microsoft/mai-ds-r1:free":
      "99b12cff575a80b2ca09a2d84980c4b479fbfccfaab91666ecc12a03b6d16f9c",
    "thudm/glm-z1-32b:free":
      "b25e1dbcbd2c0bf66de8c1979250f623438691ac5c3e8cc6cbe1ad9f5dc24858",
    "thudm/glm-4-32b:free":
      "11c66925506297bb76f1418803c8e3b4555774cf2bedf4fa8dcb8b84431714c9",
    "thudm/glm-4-32b":
      "366cedcb1125d7ee7ef138d22cbaf3072dd1fbd773e0ed84107682a02e8a97ce",
    "shisa-ai/shisa-v2-llama3.3-70b:free":
      "be70337ce51317ff66489c6bd049a7a9074c015ef03c72c81beb01b3dcfebded",
    "openai/gpt-4.1":
      "6321d9eec6337b3b6e415f6187814ca7231aa50c9240c02a592875e70ee84309",
    "openai/gpt-4.1-mini":
      "a8c86b04f11324bfbca9b0b4088c47ed69f0c794b903ffd5e0cd7afffd3d8380",
    "openai/gpt-4.1-nano":
      "edbdd24c2df0a8a4678b0736d4211719f7d21d9a7b8cafa229922500e815f1de",
    "eleutherai/llemma_7b":
      "db1655663eedbba8d019cd48434ca5d655d18af4cb82ed94ebce84a4319e2640",
    "alfredpros/codellama-7b-instruct-solidity":
      "5edbcca60dd314ff41649093858711e3d738b9fbed80a725ac04e8d7031a0b9d",
    "arliai/qwq-32b-arliai-rpr-v1:free":
      "93e238fec8563185bb79d33df8be0ba1f6b30b9f9645c287746af6f441c5a449",
    "agentica-org/deepcoder-14b-preview:free":
      "3e3062b63e80333cc96652648e207237e287c84294b1a6dbdfca2b246a7d7bed",
    "moonshotai/kimi-vl-a3b-thinking:free":
      "32265c2ff1f0c5df12db5a1d3dee78a3cbc8e54b902fb681ef33bd8fa120cd0e",
    "x-ai/grok-3-mini-beta":
      "97cb3afe921a5976bbf3d4986071d0424f7cde1e080097408bc49f9699bc0914",
    "x-ai/grok-3-beta":
      "16c91e0fa6d2364758e2603be1951f156b5bd9505787fb050fceded33e5ea764",
    "nvidia/llama-3.3-nemotron-super-49b-v1":
      "b68b9c15e668b0112f53d97c2658c11ddc3f05f5a62ad9231a86c4ac61188ffe",
    "meta-llama/llama-4-maverick":
      "287dd1da6e2f03d5ab2bbabb18a078498361590decbd97f07ca04c292c1f18c4",
    "meta-llama/llama-4-scout":
      "fbf40b89217deda5aaebf6a57f04c9a16e96828a38a4965a88a59d7c103ae896",
    "scb10x/llama3.1-typhoon2-70b-instruct":
      "c3cbbd1fd53008b6739be575614ce6e0f3ab53c02da3c9e357d47d330e49f2fd",
    "qwen/qwen2.5-vl-32b-instruct:free":
      "c0ef74999dd122a07f276e1d1c4c3707729cd85193c8a54ac2f393b5deb62f6c",
    "qwen/qwen2.5-vl-32b-instruct":
      "19cee8d949649eb721fe875b6188f065d23e6e0f2fb394241ac73f88f2fe43ac",
    "deepseek/deepseek-chat-v3-0324:free":
      "68409d474ab90a76085e20414c8480e9f84bad6cdea2e4cc3059cc852a821f53",
    "deepseek/deepseek-chat-v3-0324":
      "3422d710be8e8c52e9bb9e09908192db4766b14505d8b64608c262c257f342cf",
    "featherless/qwerky-72b:free":
      "33b1c6de956c2bb316331f9b381cc6cce51e1b28d2bdb2959c0b28d9acc928bc",
    "mistralai/mistral-small-3.1-24b-instruct:free":
      "9724facf78cc3e8307ab74081321e9a82f55b08ec78fb8504e87d3e51ead52a1",
    "mistralai/mistral-small-3.1-24b-instruct":
      "550ff379b3535b4e3ae0c03afca066109b64535b08f2e31adc894db76e52d1ea",
    "google/gemma-3-4b-it:free":
      "723d92eb915e0f16fc17ac8e691e4d38990b743f7e4d3b60797ff24968a71d1f",
    "google/gemma-3-4b-it":
      "81f41041e850a0d4fc05c7a54167d7f277dacfc9e340e3302477fe83a8132227",
    "ai21/jamba-1.6-large":
      "31911bf3408726dc386d733483b6ecbfdf4f1aa2932993df6570b18aaa3ca2a0",
    "ai21/jamba-1.6-mini":
      "bdf47b5ab1e8ffbaf4ab8d672689b9d40ed5b1e4adb98ed5020088cdbdfd5305",
    "google/gemma-3-12b-it:free":
      "0c502f9c474ee9ea52594769ddac47d1dec02e6e537fe57a21233ef8cd3cf38b",
    "google/gemma-3-12b-it":
      "be2e2c584587153df3ee5eec5dc021daa37218037a4f1b16f64b62fa4fbc49bb",
    "cohere/command-a":
      "2f6cd1e7e46f798bf82682e61966a98f7b602ccd4e9aa291fb9f2a2e658374cf",
    "openai/gpt-4o-mini-search-preview":
      "519f88a2a2cad7518a31ca6131f5c9792045168445024a5366a13fd8cfc592e6",
    "openai/gpt-4o-search-preview":
      "9869323a9a980063b694eb1363d5d26abfb31b75acfa9905edc77d95f6a05bf5",
    "google/gemma-3-27b-it:free":
      "bb2c7fc689e1eb995e1dd776dc45dc4a58ed3a5c283306066a561414c3328871",
    "google/gemma-3-27b-it":
      "2e6e93bb792eccd18e54e16cff935cd56937f22610fc75b74ca265ebe64da88e",
    "thedrummer/anubis-pro-105b-v1":
      "28515b72121da5239a913ec655963754a7f8db98a8fcfa3314ade3401c0cd3f1",
    "thedrummer/skyfall-36b-v2":
      "2829830ea94f27842acbcd1ae7b3805f0d5928943eac3a6e879fb23666445df5",
    "microsoft/phi-4-multimodal-instruct":
      "d2b24c43f911ccd52a045e5a491c35ae2b9b169fe37f9d81efd79c0f3993b3a7",
    "perplexity/sonar-reasoning-pro":
      "d59a0b712c281d7651b74943e60e06e9f40deb0e123cefdc39e2c15863aebf16",
    "perplexity/sonar-pro":
      "bc57a3af9c137e605c5b051b6b2d81b9bccfc30013e3a732e16d6877fabdbf86",
    "perplexity/sonar-deep-research":
      "a8d0efedf37c6e0f532f217a48cf19c95905e7fb458fc93293eb1764c7a326eb",
    "qwen/qwq-32b:free":
      "c020ff06a579354be60038ee2baf624644cce2ac0cf3bc16de4f347ced5ca145",
    "qwen/qwq-32b":
      "5e15486c7d83c01a317084d2a3bf12e0c7e5c94ad3ede14b06086ad573e1170a",
    "nousresearch/deephermes-3-llama-3-8b-preview:free":
      "46df3dcec3d721c7c3180aace34acc93dd16649029c8854eacc7f2a659593d95",
    "google/gemini-2.0-flash-lite-001":
      "fa3317845a45af26d657b6e379797c76f41de008edeff189b2b398e245605206",
    "anthropic/claude-3.7-sonnet":
      "ce3b51db24653e5150da48edf51f68853079a964735e7e6e1e99a03143cce83f",
    "anthropic/claude-3.7-sonnet:thinking":
      "154d48a0506513ce8d787d384ed3163fd503accad25fdee155269333e74d87c6",
    "anthropic/claude-3.7-sonnet:beta":
      "adc357c652ef7ab1b29d935d43d767ae79f54f4ae045e07ed1648c607334d67b",
    "perplexity/r1-1776":
      "c2e3c6c9636617244c23898662dc3f82c1892547ec8869de5ec0cd42a56a3da5",
    "mistralai/mistral-saba":
      "50a467e175cc0f46ddaae0a380ac49268569880b2df7825e558e243344b394a3",
    "cognitivecomputations/dolphin3.0-r1-mistral-24b:free":
      "b181c8950bd6c1494ed66dd32b0959c03236fb106de15d8abb8087a8dd38167b",
    "cognitivecomputations/dolphin3.0-mistral-24b:free":
      "e2aa6a26aa5d2a3e6a5d0d257884415e5ab4954ad9425b4a0c724a6f94255232",
    "meta-llama/llama-guard-3-8b":
      "e33512abee76cc5376471f666069aa321c6a131a4e0f1cccb3162b5f9ef30064",
    "deepseek/deepseek-r1-distill-llama-8b":
      "7350446ea3a7ef0978d119c88b300cc205e1a598df59e1d35f8f4ec8a93dcd93",
    "google/gemini-2.0-flash-001":
      "21e2de5d0bcd84253fc8fddad7cdbbd285d3c1b592c80ecac7019e7b9ee08726",
    "qwen/qwen-vl-plus":
      "348391443b3f7a6049872e5f41517659224ecd3fbb5abef2737e4bdb3b4508cf",
    "aion-labs/aion-1.0":
      "2c4e0a7c57edced712bd1279782a1e95b9429dd1c89237870040247969544492",
    "aion-labs/aion-1.0-mini":
      "50db0c2b3b8b09b6c074a22eb6c438e102b3109fed3c46c6267024639b6382c7",
    "aion-labs/aion-rp-llama-3.1-8b":
      "58a7cb9ae0f004fec51dab97a838292ec8334bf28be13210eef002d43f9820f5",
    "qwen/qwen-vl-max":
      "ab68d03a3282a5bc5017712314b2d68dae6c90ff889b2b5db1c2ea3044785616",
    "qwen/qwen-turbo":
      "17e2a34616554aacebe3a70169babe5e470b3df8c762d82b4ca0092dc0cea70c",
    "qwen/qwen2.5-vl-72b-instruct:free":
      "83de1d63a11d14cd493eceebc77c841c28d37529779bcad6c70bc131fc29b6a9",
    "qwen/qwen2.5-vl-72b-instruct":
      "4a51aa0dcda19111759463cbcad5736861097f20f38f61f1624d980d9b43dd8e",
    "qwen/qwen-plus":
      "ec2f942635b5aea6348c54d31fe097e711f2d228dcbf2f6835d3e90b2730e3c7",
    "qwen/qwen-max":
      "7f2ba2ad030beec32c00da2e7cb8fcec800f6662dafce9faa88486091191a06d",
    "deepseek/deepseek-r1-distill-qwen-1.5b":
      "2664c943f4cedcefa5b026079442a1bfa0f8610ee4075b1dd39e69ffed528eb7",
    "mistralai/mistral-small-24b-instruct-2501:free":
      "9f16181dc1da4100eb9893cabfd079670024c93fb48ad7233057b282e4d7fdd2",
    "mistralai/mistral-small-24b-instruct-2501":
      "d08e763324683319b2acf89e3f90f5e9b08103cd91b1470d2a3bf4e268f796e7",
    "deepseek/deepseek-r1-distill-qwen-32b":
      "7a184d9a0dbc32d7acca5f8a8648f54ca6f78066943e90db4741c949ce6eeebc",
    "deepseek/deepseek-r1-distill-qwen-14b":
      "75959c42e110fc0e073e3adea19f10deb99a0decfc3aea90233362558897a3ba",
    "perplexity/sonar-reasoning":
      "3e095278d93b0086dbfd772117f85adcd2f18660259c7d1c8c7e2a9fc9f15496",
    "perplexity/sonar":
      "c7d87d91a4e92e384b35b7f72d1ef62c6828c16e218cf4e04aaad528006dfb55",
    "liquid/lfm-7b":
      "86b430d8b9e6c40647ebe2992a9d23bbf392c64669294ed08bd8f5f0a08dd609",
    "liquid/lfm-3b":
      "7f3aad491fee809ca8dad5088755020d894c1e2a6589c2218ede66f5e3402e99",
    "deepseek/deepseek-r1-distill-llama-70b:free":
      "024515f871c4e8d31bf60326dff0bd4e1faa84d39293972b752a348c99cc4c15",
    "deepseek/deepseek-r1-distill-llama-70b":
      "e2cd0210dace0d035281a391ecf885e14db3f1c8b2dc90e0fbd3c91ed3241ad9",
    "deepseek/deepseek-r1:free":
      "2ce11289ef731b6457be5a1ae77b1e265b181323743de1b0c4cad54a470c4318",
    "deepseek/deepseek-r1":
      "3dda8326447facc86dd5a556a6d3b849725abb862df5cd85494194396c6df199",
    "minimax/minimax-01":
      "83d455bccd314a63d9f8c4cb7d231a89f73225379f0243643f3e7494ba9a8197",
    "mistralai/codestral-2501":
      "334a652c822716ca46994df52c0817d461168977edbd87c3b7556799dd917dfc",
    "microsoft/phi-4":
      "d991c257652be8952738571a2dfc6a914673616ad355a578f95507e64fcedc30",
    "deepseek/deepseek-chat":
      "1b0316eceb63edb86fbc906b16227f376b95a379627510055c87238fad735944",
    "sao10k/l3.3-euryale-70b":
      "8d271aba1da203bf1880efb915d8efad95ae074a62af8db0e0b87ccf98adc145",
    "x-ai/grok-2-vision-1212":
      "c3b9a812c3dd173c801629ee4c9510ace0cb2f49c8b296833439b982a90f820c",
    "x-ai/grok-2-1212":
      "c0f69e9a51924dccd39bd42d1c4619dca1a89afd9e3b1f274e8fcdd810dc8ce9",
    "cohere/command-r7b-12-2024":
      "e5586d2c54de75ecf353840a636f85b3b3ca59a38b63349ce8c47fc5cdac805d",
    "google/gemini-2.0-flash-exp:free":
      "4ff572eafbb4db69830e8b7c65406b9d50e265c6e90f53adfd488d5e3202ef4d",
    "meta-llama/llama-3.3-70b-instruct:free":
      "521f81c896fff96492e6a37d3517a3c07302ccea891fe49557d057e522d520ee",
    "meta-llama/llama-3.3-70b-instruct":
      "510fbefc16348c621207ffbddb0b7f7a710e3f59fce30ac3167ad61d1c1b93f6",
    "amazon/nova-lite-v1":
      "a2fd629e6a6e18a71c22a036edd6fb82f270ed9330e6e5e6e62694563671a20c",
    "amazon/nova-micro-v1":
      "feb037cca102f5a8691dd56058b766536052567600defd36328fe7c5b6d2f379",
    "amazon/nova-pro-v1":
      "de080f9b25943c0fccb53aa43aae1f83335dfb172d47c0e6a10621efd3490ec0",
    "eva-unit-01/eva-qwen-2.5-72b":
      "c0987eb209163e31e27b11ee605737541c0cf81901b50c76456d9f5420f60600",
    "openai/gpt-4o-2024-11-20":
      "c341f3bb7af337c97541950dda83207eecfe62c72fe49a82a84ff979580798eb",
    "mistralai/mistral-large-2411":
      "609167f6a2fbf4243549003a73c729606470ec0a905c2df7ce97cac2765f4d4b",
    "mistralai/mistral-large-2407":
      "d507cd407519f2ea0b606498bde959f258a677c14812a87120ba7055bbe880cf",
    "mistralai/pixtral-large-2411":
      "1aab4559b63038ec6c20c5ef8c365c4fff04a3ee5d53e9b9cee55aeb7d81958e",
    "infermatic/mn-inferor-12b":
      "8facc5c40bb7b65cf9a89ef35508237b490132669120869cbc5d84d33942ba0d",
    "qwen/qwen-2.5-coder-32b-instruct:free":
      "3a8ec5ccd54e4f7605101612c2c89735fa64e681f2be31c71f5b9c4c7702cf9e",
    "qwen/qwen-2.5-coder-32b-instruct":
      "ad8c2c3180257ed83a51510c98f7d62fd81cd9442a6d8c194f04730afb5340cc",
    "raifle/sorcererlm-8x22b":
      "9be46d312c0ed262ebfc992fea150620b56f399c444094ac86a6939225f10960",
    "thedrummer/unslopnemo-12b":
      "17b6810316f7525a266713878090fcbd0627545a8d333dd16c4b00b48ad4b278",
    "anthropic/claude-3.5-haiku:beta":
      "c31e7b83d1246771f7902daba04ef01103ead8a238944e65994c04da0dddb874",
    "anthropic/claude-3.5-haiku":
      "147713835f7cb00b32d0a712d98def10703bc43710ed5e890dbd2ba881c797db",
    "anthropic/claude-3.5-haiku-20241022:beta":
      "7c20980ffc020af23bea8c976634a183633bf92884b664ce278625d0f9fd5bb1",
    "anthropic/claude-3.5-haiku-20241022":
      "4f1b4bdf811aaa34e47cfa55a375427816df997997aec3256ba710b68bfc71a2",
    "anthracite-org/magnum-v4-72b":
      "de65d63706af68501ba230c05fe5e3b8170715b2b7be7659b94acfbcce7c0aec",
    "anthropic/claude-3.5-sonnet:beta":
      "ec0170be5486b53eb079626a2c4fa23a9ecf14336487644d2d857cef35ea51cf",
    "anthropic/claude-3.5-sonnet":
      "ee31a49b5a9a93702e3d227b52971b089fbfb25de99f14ec886c85c865e68bd7",
    "mistralai/ministral-8b":
      "0117892a5b81b12f0aaf4e68e55f04f181d5c36dc2777d5ec9171e59d87faa54",
    "mistralai/ministral-3b":
      "004d01167c5d89a6cb551260092b63c1d69030d4a2a59454f6c6fbcba3658540",
    "qwen/qwen-2.5-7b-instruct":
      "dd2d9ed67c07cb6c0c52fe04661577d625a608e2062d31c2dd05d9423d127641",
    "nvidia/llama-3.1-nemotron-70b-instruct":
      "0a742b6342f2f764a90bbbb5d371b5e6ab5d4d6d7574b565c888fe8bec35045d",
    "inflection/inflection-3-pi":
      "9ea415cebdf39d31400e7108afaa9a5b1edd22f5ff5c5eceaf872d5e23eaf77f",
    "inflection/inflection-3-productivity":
      "ddfecb556578e55f0b6c5b2db456e3056613e8fa0268fed893e7edbdb5b0eb9b",
    "google/gemini-flash-1.5-8b":
      "e0070ad2029f4ba33851857a8bb8b90d247433148aa74b7bfb01917ab61cfadb",
    "thedrummer/rocinante-12b":
      "205a17650265f8899887d9c028b11d2e4a12ddcd004e5f683853f7a71702556d",
    "liquid/lfm-40b":
      "d11ef2ead1a8287ae8b9f200678402ab70d424cda79a3823117cb11b0a75f688",
    "meta-llama/llama-3.2-3b-instruct":
      "57739ec2265fdb2f36c27f1081ac026f0321d9b9048e2762d56c720ce795ada8",
    "meta-llama/llama-3.2-1b-instruct":
      "7ef31da56e61ecab8d4e674e3be3ea8511def79a2c1993e4f9f626b0f9d41661",
    "meta-llama/llama-3.2-11b-vision-instruct:free":
      "5df8758e3e0c2bc22c0619fc91d60be008e4ca904f517ae3e3d7043818d6135d",
    "meta-llama/llama-3.2-11b-vision-instruct":
      "5523a4d17be9e1245712c993a54cd670377709528b79e850ea99710a78df04c2",
    "meta-llama/llama-3.2-90b-vision-instruct":
      "96a6fce22e5109daa4c7af798642641de2cf322264d905925740317102298a28",
    "qwen/qwen-2.5-72b-instruct:free":
      "ece4bec74b7b4dbd101da534e46f3503e10de8bc45046686cde796527034a588",
    "qwen/qwen-2.5-72b-instruct":
      "1a2050122800d9fec0c65e8552468326de8527cb504089431fecefe4d15a4e19",
    "neversleep/llama-3.1-lumimaid-8b":
      "efa05e38ec7f6ff1457683b00f5e565fd7c0ae986b33823f40f2e05654c9bc0e",
    "openai/o1-preview-2024-09-12":
      "4d7fec67ffba0df599fd5f0eb84bfd260cb842883c4503079e02ab78feab16cf",
    "openai/o1-mini-2024-09-12":
      "a455255a78901b19a7eebe7c3959e7dea87a09a91031943fd945eb2b028fdb5c",
    "openai/o1-preview":
      "ed2995b1bea29bf4112713137762844fc50c072cfe0a7e429247e178a25e550f",
    "openai/o1-mini":
      "b909f8de7092967da857f93eef6bd419846afc9df20f1876cfda09cdc08daf42",
    "mistralai/pixtral-12b":
      "666c5559f045e8284efa6ccafb02f4bb684f0345af835c12dd5bb30746e2e7c2",
    "cohere/command-r-08-2024":
      "ca0e9cc57a8647d81015338f906b3a679d7f64a347c92a2ccb2bf6cee50d60d9",
    "cohere/command-r-plus-08-2024":
      "5a3e650cc804ddb826d2416f18379b0570b7ccd17a2070327d403bf4a1604dd1",
    "qwen/qwen-2.5-vl-7b-instruct":
      "07e5b79bd12fe3c7b87f3c2907b0bb716cef71d62bac6a791f2daa98cfa329da",
    "sao10k/l3.1-euryale-70b":
      "600b1f202cec3ec98620c6472de507e8f5ddfc4917005dad04f4c4c3d65c8dd4",
    "microsoft/phi-3.5-mini-128k-instruct":
      "ee28a92d6024ce37f2ad8ac872400268439c29b2cbf6fdd51a457ab5d6e968d2",
    "nousresearch/hermes-3-llama-3.1-70b":
      "6bb1385d2db5d4815af0a38afca5b1ebcd2daddad943b950e2d33e8947c8b293",
    "nousresearch/hermes-3-llama-3.1-405b":
      "490b7922ca8dfabdb893b4f6852c7db9b72edce9fb64d3c67adafb8bb3d2a941",
    "openai/chatgpt-4o-latest":
      "d740c45cab89d294981dc01031f4ff02cc7ccfe0216b455afbf740c184c43c18",
    "sao10k/l3-lunaris-8b":
      "5f5a04bd7fbd893df51aef92cbf57a87162faa6fac366667710615f04cc7dc1e",
    "openai/gpt-4o-2024-08-06":
      "5647bc24d21d7389e2bd072abf361558e30c0369841a988a92dc9bc6f099a19b",
    "meta-llama/llama-3.1-405b":
      "8f806f63d4f9471768953dbe200e601c0866b6d788fefeba17476f851b6ff6a0",
    "nothingiisreal/mn-celeste-12b":
      "d127b603a6ea2a3fdd837db067e1ec8fb4a734ccc6bd426ce32a6b1090d5f6cb",
    "meta-llama/llama-3.1-70b-instruct":
      "9bcf498ed99d9b490fa72ff9e6dde7b44fe56decd724c89fe969f4902d66ca82",
    "meta-llama/llama-3.1-8b-instruct":
      "3012d5c5367b03cf0302003437734261a5360d1a34df322ca3ff637d8e1a26d3",
    "meta-llama/llama-3.1-405b-instruct:free":
      "dddc777eec906bc0ff0bed27a22e5a774a1d11cf023f3dc946a463518048deca",
    "meta-llama/llama-3.1-405b-instruct":
      "a20b08a71d2f8689b20484be5778dd137bbc95c5afc144634bfb8d042cdb5641",
    "mistralai/mistral-nemo:free":
      "91672a64fe7c5dc15bf18115c82540e4c82bedf2465083d8dc66504be891ee2b",
    "mistralai/mistral-nemo":
      "ee7e77bf410d59adbce1024db32d4e69bbcbc1cdb0daa4839c3c6143e515d1bd",
    "openai/gpt-4o-mini":
      "3b95156595663a0c56199aa9884f6de91e125e9b69378808c0334e1d268fef94",
    "openai/gpt-4o-mini-2024-07-18":
      "65b0ce70e883ba00ca65784028be6130ae026e287bd070543ec4e51fa841fd09",
    "google/gemma-2-27b-it":
      "98962d18d7a7ada637a8f5a836bbe047421d088d927220c00cb81747456b4967",
    "google/gemma-2-9b-it:free":
      "5d138769ddca658cd4faf895b664780eb63af9fac56bf3d99c768b15bd6db561",
    "google/gemma-2-9b-it":
      "7582670e1c2aeac08850296588af2a16f0fc6451064d39a4fef27edafea9e080",
    "anthropic/claude-3.5-sonnet-20240620:beta":
      "992e4be9a7e1213e5f9f23bd4471cfc7b06b935fd0a4400690765531fe4a4b9b",
    "anthropic/claude-3.5-sonnet-20240620":
      "90add5c81b1574d6aac534385be41fe72e903e4ad15671819ca430390b34087d",
    "sao10k/l3-euryale-70b":
      "95abc00bd62a085ee6860364f77824da5336f204efab52cd242b651737ab7ec9",
    "cognitivecomputations/dolphin-mixtral-8x22b":
      "293b3032aaa25d29cb9f9af4a9e8fd3dbee02ecbe235025cfce42174e00f4f69",
    "qwen/qwen-2-72b-instruct":
      "11370612d128a05338ef1a71a6890a4256b8e425c2b4180a4849dca28480e3b0",
    "mistralai/mistral-7b-instruct-v0.3":
      "86e66f852c67aebc637f39358e2da8bb52852c65bddedf29de5672952f391d45",
    "nousresearch/hermes-2-pro-llama-3-8b":
      "0b45881c0be74439129db5898d2b84c4fb78c4a4abf5c7000e470087a26e388f",
    "mistralai/mistral-7b-instruct:free":
      "a8ea0b67d391d91acb371fd98a5d868f2947872afa83457475d7ae2cde234586",
    "mistralai/mistral-7b-instruct":
      "270e462a9b29ac686d532602311c2eede299f9367f68db09ed099df88eddd6ff",
    "microsoft/phi-3-mini-128k-instruct":
      "d53da44cfc25fc33704a56027f82225c0c1ad128fe3740343492dae427e42088",
    "microsoft/phi-3-medium-128k-instruct":
      "98ebdb4d6ca73c55dc368f92d614568869314ecc3cb97dcbd0fa3d840398e62b",
    "neversleep/llama-3-lumimaid-70b":
      "e8f28903b897d1db7a7524cd51d0b9519d1700ff7fd2c65bbf9e7f7ee1a79679",
    "google/gemini-flash-1.5":
      "8866f680c4bb662e6ce036c397f24afafb26f1d22eb7301fd567ea0713bedb7c",
    "meta-llama/llama-guard-2-8b":
      "2819dab4ed703d4c932652018aaaeae03080965d7eee9de4a3aeed156f8615f4",
    "openai/gpt-4o":
      "53b404c9d45b7116639764d3809e853d34d7531296b4811ef162e782bca514ad",
    "openai/gpt-4o:extended":
      "552358f38a3301ab7d0ef63f6907ab51b828585f704adc5d963bcb176e506ab8",
    "openai/gpt-4o-2024-05-13":
      "b7ad214c3866f459a7466b935edfae4faa5b2142dad1a2918573fad06daa6cce",
    "sao10k/fimbulvetr-11b-v2":
      "4b0a31afb712744fff19fb091f366b43501766158ffba5aae9dbc8f8406b04d5",
    "meta-llama/llama-3-70b-instruct":
      "4a0e81b54b808ebcdadd4bd0f3d9a91e139347113593a7f3890e884891378ab7",
    "meta-llama/llama-3-8b-instruct":
      "ad01f786bd3b1c60f31397896e20752b03e6101a764d43a4e9afe8e4074fea54",
    "mistralai/mixtral-8x22b-instruct":
      "d449cdff41a5308cce0ed3f305d73b7893ceadc85ac011d4f25fad703368867b",
    "microsoft/wizardlm-2-8x22b":
      "663d1371c6d5766c749d9ee23089523cc2fb0c17f769afa0609260d0f8e28928",
    "openai/gpt-4-turbo":
      "2727d6cf1f76e5091de1bcda66334450c0fd1c0af3d46acbe85c9eae2fc7dae0",
    "google/gemini-pro-1.5":
      "68cdfae9dfbdfb577c6fa9a7c3070adf382ea66b8339eddef631514e617215c7",
    "cohere/command-r-plus":
      "d88394c1906698d95474658d9bdfcf9c1df9ae349f3308a4db4db36c1893c8f9",
    "cohere/command-r-plus-04-2024":
      "e00137d093f85a1cd0d3c4f3ca7fa813eddb986f3548602a16ba209728a70dce",
    "sophosympatheia/midnight-rose-70b":
      "0a4a022c5a0fc76a828737a258b8dd5e05081db7f6dfb1b70436b411504d4631",
    "cohere/command":
      "fabe39b654d787feffa819fb87f0dafada08e77dc9d6afcbe38689c68c302160",
    "cohere/command-r":
      "d91b6c7bbb7a6baa37102013133252ffbf660879b66ad70b9cae64b0f318a4ab",
    "anthropic/claude-3-haiku:beta":
      "10a5e53e788f272ba80c0d0879bf3d695dbe63d458073a409b3f5061210e8549",
    "anthropic/claude-3-haiku":
      "d687fbae9e14ee330f7ea2322a97352f71c53a19f32c50c3d9eff2ca9f8b73e5",
    "anthropic/claude-3-sonnet":
      "6fba34ab7505cb40ce8488f46d3a7f7f23a713602305bb417c2d025c74f68924",
    "anthropic/claude-3-opus:beta":
      "426084707fbb8a66b52db2af087fa4c4694b8fe4d1a844709b291ff6ca382258",
    "anthropic/claude-3-opus":
      "f156437eb3f5bd4e6b09fa99e2d68ccde01611ca79dc95ea4903d3d583dff197",
    "cohere/command-r-03-2024":
      "530349eca983bd2bbb3846a2c9f710d57cee6e2c78d26cf00c83a0b65b661fd6",
    "mistralai/mistral-large":
      "401cce6f52199d5acd25ceb77eef84a182af0950b8b380dea1a644dcc6d2614f",
    "openai/gpt-4-turbo-preview":
      "6ac19edcb8ad7d6aa6c7870e6366b159938303ca61f515196f0c4d533fc500f7",
    "openai/gpt-3.5-turbo-0613":
      "d59137e5266a33b7368c113668cf8f51047c0d682959d91c83bee6422efbab4d",
    "nousresearch/nous-hermes-2-mixtral-8x7b-dpo":
      "17732920ac7b0022f6fec0dc4cf2afb49de76798ce72e8c69c330223dec1c7f0",
    "mistralai/mistral-small":
      "6c579c6a744955c4f7c821a63d9c9bc951a7ff89497dfc9176d17c8408c30713",
    "mistralai/mistral-tiny":
      "b07e38bf90a4d15a99111e5e0090c8cecafc2a881d046d298c5a97fd86f3a44e",
    "mistralai/mistral-7b-instruct-v0.2":
      "64410823cf4630d07e2713b227a805007ed8297a2569e9867bf1a7c79f6de55e",
    "mistralai/mixtral-8x7b-instruct":
      "e3e61161b93bf91080e37870f33af94edfa26bcf24d521685ecd5deffab0967e",
    "neversleep/noromaid-20b":
      "a101a97a38b372b53e9e84b16abd0a1484231c67b7ac43292eed5b87e61d6740",
    "undi95/toppy-m-7b":
      "83f7624e62e6cf54b6d36b7c8aa29ee20adcdb0ddef12867543ec6964bdb49e7",
    "alpindale/goliath-120b":
      "ad10edd377c9a773ad259106544e3c364a8f117576dd5b8ab1563eb093bdeffd",
    "openrouter/auto":
      "2297a83b9ecad67ea28b77986317c4ed3c5b38daaee3d96e9a899ef4d05f7e17",
    "openai/gpt-3.5-turbo-instruct":
      "9f22f9174e209f337133b1d9dd253d3372dc062312182eef9464435c0ffba0d7",
    "mistralai/mistral-7b-instruct-v0.1":
      "9d2cf5b3576b3904b343bff6172f3b3078a1c5bd06e3fff80de647001361cb8e",
    "pygmalionai/mythalion-13b":
      "b479e6fe5585486fee56ca913baae05db01b3b6cd9f14541a9ef2da6688c5187",
    "openai/gpt-3.5-turbo-16k":
      "898a9bafd1a1914c9a96337dd5227ae9dd25ce1a788c90b5ec3f79a60114db3b",
    "mancer/weaver":
      "45ddd2bc9c9cfc296a1371e7bd92eeb51e3baa0cd340a11903ea7aa221b72bff",
    "undi95/remm-slerp-l2-13b":
      "bc3e3b35f9fad54833b0a656b908bb90d91295f766e4fce2716b60f750874cc5",
    "gryphe/mythomax-l2-13b":
      "28231a299d726353fc9059dd57aa80470eb86d16163b4304bfa253e3b670cc45",
    "openai/gpt-4-0314":
      "c7ad8f39059c3dc0073b93380554c047581cba796d5446e0c2661e9478a3387b",
    "openai/gpt-3.5-turbo":
      "6035750f7d04713b77853ca0284bdb6980393c10febd69b7b6c14c870b600a83",
    "openai/gpt-4":
      "d06c4f666e70d7e23ed3d1553066244627327961cbe1e5fbedce3627c47915b5",
    "nvidia/llama-3.1-nemotron-ultra-253b-v1":
      "f569aff0ece30801df8e80ce03e8f7b32bec66e215fed07feb9b8dc42c1a4ac4",
    "openai/gpt-oss-120b":
      "11a53826781276a79f0a4b0dfa4126b643a459af885eeaec1df023d5e5e12bcf",
    "openai/gpt-oss-20b":
      "8b022e7a1cc6b57a86cf8def0274086e1e04600dd687631b1db2cb5e3b6b6bdb",
    "openai/gpt-oss-20b:free":
      "ce0b57d3d734f05b86d876f328ce1920a0d4e436e16090d2975a6e956e057aa2",
  };

  /**
   * The AskExpertsClient instance
   */
  private client: AskExpertsClient;

  /**
   * The LightningPaymentManager instance
   */
  private paymentManager: LightningPaymentManager;

  /**
   * Profit margin percentage to add to each transaction
   */
  private margin: number;

  /**
   * Map of active quotes with their resolution callbacks and stream flags
   */
  private activeQuotes: Map<
    string,
    {
      resolveCallback: (value: boolean) => void;
      stream: boolean;
      repliesPromise: Promise<Replies>;
      model: string;
      content: ChatCompletionCreateParams;
    }
  > = new Map();

  /**
   * Creates a new OpenaiAskExperts instance
   *
   * @param paymentManager - The LightningPaymentManager instance
   * @param options - Optional configuration
   * @param options.compression - Custom compression implementation
   * @param options.pool - SimplePool instance for relay operations
   * @param options.discoveryRelays - Array of discovery relay URLs to use as fallback
   */
  constructor(
    paymentManager: LightningPaymentManager,
    options?: {
      pool?: SimplePool;
      discoveryRelays?: string[];
      margin?: number;
    }
  ) {
    this.paymentManager = paymentManager;
    this.margin = options?.margin || 0;

    // Create the AskExpertsClient instance with the provided options
    this.client = new AskExpertsClient({
      pool: options?.pool,
      discoveryRelays: options?.discoveryRelays,
      onPay: this.onPay.bind(this),
    });
  }

  /**
   * Gets pricing information for a model in sats per million tokens
   * Always returns undefined as pricing is handled by AskExperts
   *
   * @param model - Model ID
   * @returns Promise resolving to undefined
   */
  async pricing(model: string): Promise<PricingResult | undefined> {
    return undefined;
  }

  /**
   * Estimates the price of processing a prompt
   * Uses AskExpertsClient to get a quote from an expert
   *
   * @param model - Model ID (used as expert pubkey or alias)
   * @param content - The chat completion parameters
   * @returns Promise resolving to the estimated price object
   */
  async getQuote(
    model: string,
    content: ChatCompletionCreateParams
  ): Promise<{ amountSats: number; quoteId: string }> {
    // Create a promise that will be resolved when the quote is received
    return new Promise<{ amountSats: number; quoteId: string }>(
      async (resolve, reject) => {
        try {
          // Check if the model is an alias, and if so, use the corresponding pubkey
          const expertPubkey = OpenaiAskExperts.EXPERT_ALIASES[model] || model;

          // Fetch the expert using the expert pubkey
          const experts = await this.client.fetchExperts({
            pubkeys: [expertPubkey],
          });

          // Check if the expert was found
          if (experts.length === 0) {
            throw new Error(
              `Expert with ${
                model === expertPubkey ? "pubkey" : "alias"
              } ${model} not found`
            );
          }

          // Get the first expert from the results
          const expert = experts[0];

          // Check if the expert supports the FORMAT_OPENAI format
          if (!expert.formats.includes(FORMAT_OPENAI)) {
            throw new Error(
              `Expert with ${
                model === expertPubkey ? "pubkey" : "alias"
              } ${model} does not support the FORMAT_OPENAI format`
            );
          }

          // Call askExpert with the fetched expert and a custom onQuote callback
          const repliesPromise = this.client.askExpert({
            expert,
            content: content,
            format: FORMAT_OPENAI,
            onQuote: async (quote: Quote, promptObj: Prompt) => {
              // Find the lightning invoice
              const lightningInvoice = quote.invoices.find(
                (inv) => inv.method === METHOD_LIGHTNING && inv.invoice
              );

              if (!lightningInvoice || !lightningInvoice.invoice) {
                throw new Error("No lightning invoice found in quote");
              }

              // Parse the invoice to get the amount
              const parsedInvoice = parseBolt11(lightningInvoice.invoice);
              // Get the base amount from the invoice
              const baseAmountSats = parsedInvoice.amount_sats;

              // Apply margin percentage and add fixed fees
              const amountSats =
                baseAmountSats +
                Math.ceil(baseAmountSats * this.margin) +
                OpenaiAskExperts.FEES;

              // Generate a unique quote ID
              const quoteId = quote.event.id;

              // Create a promise that will be resolved when the payment is approved
              const paymentPromise = new Promise<boolean>((resolvePayment) => {
                // Store the resolution callback, stream flag, and replies promise in the activeQuotes map
                this.activeQuotes.set(quoteId, {
                  resolveCallback: resolvePayment,
                  stream: !!content.stream,
                  repliesPromise,
                  model: expertPubkey, // Store the actual expert pubkey with the quote
                  content: content, // Store the content with the quote
                });
              });

              // Attach a rejection handler to the repliesPromise to clean up activeQuotes
              // if the promise is rejected and createChatCompletion is never called
              repliesPromise.catch((error) => {
                debugError("repliesPromise deleted active quote", quoteId);
                this.activeQuotes.delete(quoteId);
              });

              // Resolve the getQuote promise with the amount and quote ID
              resolve({
                amountSats,
                quoteId,
              });

              // Return the payment promise
              return paymentPromise;
            },
          });
          repliesPromise.catch((error) => {
            debugError("repliesPromise rejected:", error);
            reject(error);
          });
        } catch (error) {
          debugError("Error estimating price:", error);
          reject(error);
        }
      }
    );
  }

  /**
   * Execute a chat completion request
   *
   * @param quoteId - Quote ID for the request
   * @param options - Additional options for the request
   * @returns Promise resolving to chat completion or chunks
   */
  execute(
    quoteId: string,
    options?: any
  ):
    | APIPromise<ChatCompletion>
    | APIPromise<AsyncIterable<ChatCompletionChunk>> {
    // Get the quote data from the activeQuotes map
    const quoteData = this.activeQuotes.get(quoteId);

    if (!quoteData) {
      throw new Error(
        `No active quote found for ID: ${quoteId}, might be expired.`
      );
    }

    // Create a promise that will be wrapped in an APIPromise-like object
    const promise = this.createChatCompletion(quoteData.content, { quoteId });

    // Add properties to make it look like an APIPromise
    // This is a simplified version that mimics the structure
    const apiPromise = promise as any;

    // Return the enhanced promise
    return apiPromise;
  }

  /**
   * Creates a chat completion
   * Approves the payment for the quote and returns the result
   *
   * @param body - Chat completion parameters
   * @param options - Optional parameters including quoteId
   * @returns Promise resolving to chat completion or chunks
   */
  private async createChatCompletion(
    body: ChatCompletionCreateParams,
    options?: any
  ): Promise<ChatCompletion | AsyncIterable<ChatCompletionChunk>> {
    try {
      // Get the quote ID from the options
      const quoteId = options?.quoteId;

      if (!quoteId) {
        throw new Error("quoteId is required in options");
      }

      // Find the quote data in the activeQuotes map
      const quoteData = this.activeQuotes.get(quoteId);

      if (!quoteData) {
        throw new Error(
          `No active quote found for ID: ${quoteId}, might be expired.`
        );
      }

      // Approve the payment
      quoteData.resolveCallback(true);

      // Store stream flag and model before potential deletion
      const isStream = quoteData.stream;

      try {
        // Wait for the replies from the expert
        const replies = await quoteData.repliesPromise;

        // Remove the quote from the activeQuotes map
        this.activeQuotes.delete(quoteId);

        // Check if streaming is requested
        if (isStream) {
          // Return an AsyncIterable that yields ChatCompletionChunk objects
          return this.createStreamingResponse(replies);
        } else {
          // Read all replies and return a single ChatCompletion
          return this.createNonStreamingResponse(replies, quoteData.model);
        }
      } catch (error) {
        // Make sure to delete the quote from activeQuotes even if the promise is rejected
        this.activeQuotes.delete(quoteId);
        throw error;
      }
    } catch (error) {
      debugError("Error in createChatCompletion:", error);
      throw error;
    }
  }

  /**
   * Creates a streaming response from replies
   *
   * @param replies - The replies from the expert
   * @returns AsyncIterable of ChatCompletionChunk objects
   */
  private async *createStreamingResponse(
    replies: Replies
  ): AsyncIterable<ChatCompletionChunk> {
    for await (const reply of replies) {
      yield reply.content as ChatCompletionChunk;
    }
  }

  /**
   * Creates a non-streaming response from replies
   *
   * @param replies - The replies from the expert
   * @param model - The model name
   * @returns ChatCompletion object
   */
  private async createNonStreamingResponse(
    replies: Replies,
    model: string
  ): Promise<ChatCompletion> {
    // Read all replies
    const allReplies: Reply[] = [];
    for await (const reply of replies) {
      allReplies.push(reply);
    }

    if (allReplies.length === 1 && typeof allReplies[0].content !== "string") {
      // The content should be a ChatCompletion object
      return allReplies[0].content as ChatCompletion;
    } else {
      const content = allReplies.map((r) => r.content as string).join("");
      return JSON.parse(content) as ChatCompletion;
    }
  }

  /**
   * Callback for handling payments
   * Called when a quote is accepted to process the payment
   *
   * @param quote - The quote to pay
   * @param prompt - The prompt being processed
   * @returns Promise resolving to payment proof
   */
  private async onPay(quote: Quote, prompt: Prompt): Promise<Proof> {
    // Find the lightning invoice
    const lightningInvoice = quote.invoices.find(
      (inv) => inv.method === METHOD_LIGHTNING && inv.invoice
    );

    if (!lightningInvoice || !lightningInvoice.invoice) {
      throw new Error("No lightning invoice found in quote");
    }

    // Pay the invoice using the payment manager
    const preimage = await this.paymentManager.payInvoice(
      lightningInvoice.invoice
    );

    // Return the proof
    return {
      method: METHOD_LIGHTNING,
      preimage,
    };
  }

  /**
   * Disposes of resources when the instance is no longer needed
   */
  [Symbol.dispose](): void {
    // Dispose of the client
    this.client[Symbol.dispose]();
  }
}
