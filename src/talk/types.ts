/** Things to say to keep a tired driver awake (src/talk). */

/** off: never; tired: once the break is due or the driving looks tired; often: also every 20 minutes on long drives. */
export type TalkMode = 'off' | 'tired' | 'often';

export type TalkTopic = 'jokes' | 'riddles' | 'malaysia' | 'world' | 'cars' | 'animals' | 'lifehacks' | 'science';

export const TALK_TOPICS: TalkTopic[] = ['jokes', 'riddles', 'malaysia', 'world', 'cars', 'animals', 'lifehacks', 'science'];

/** A thing to say: a line, or a question with its answer a few seconds later. */
export type TalkItem = string | readonly [question: string, answer: string];

export type TalkSet = Record<TalkTopic, readonly TalkItem[]>;
