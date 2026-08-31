// client/entities/NPCData.js — thin re-export of the StoryBank.
//
// All NPC definitions (personality, dialogue trees, gift affinities, quest
// lines) live ONCE in shared/story/npcs.js, which is loaded:
//   - in the browser via <script src="shared/story/npcs.js"> → window.SpaceFarmerStory.npcs
//   - headless (Node tests / tooling) via client/systems/StoryService.js → createRequire
// This module only re-exports, so the client scenes, the server (FarmRoom
// gift tables), and the RL environment can never drift apart on story facts.
import { npcs } from '../systems/StoryService.js';

export const NPC_DATA = npcs;
