// client/entities/AlienData.js — thin re-export of the StoryBank.
//
// First-contact alien scenarios + contact doctrines live ONCE in
// shared/story/aliens.js (see that file's header for the load paths). The
// client scenes, the RL env, and the Python alignment evaluator all derive
// their alien story from the bank — no module keeps a private copy.
import { aliens } from '../systems/StoryService.js';

export const CONTACT_DOCTRINES = aliens.doctrines;
export const ALIEN_DATA = aliens.aliens;
export const ALIEN_BY_ID = aliens.byId;
