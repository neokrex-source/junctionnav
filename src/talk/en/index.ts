/** The English set: 1,000 jokes, riddles, facts and tips. */
import type { TalkSet } from '../types';
import { animals } from './animals';
import { cars } from './cars';
import { jokes } from './jokes';
import { lifehacks } from './lifehacks';
import { malaysia } from './malaysia';
import { riddles } from './riddles';
import { science } from './science';
import { world } from './world';

export const EN_TALK: TalkSet = { jokes, riddles, malaysia, world, cars, animals, lifehacks, science };
