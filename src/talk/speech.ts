/**
 * What the stay-alert guide says: the break reminders, the tiredness warning, and the lead-ins
 * for the jokes, facts and riddles, in English, Malay and Japanese.
 */
import { LANGS, type LangCode, type Units } from '../routing/instructions';
import type { Sign } from '../nav/alert';
import type { TalkTopic } from './types';

/** The next rest area on the route, when one was found. */
export interface RestAhead {
  name: string;
  /** Metres ahead along the route. */
  dist: number;
}

/** "2 hours 15 minutes", "2 jam 15 minit", "2時間15分" (to the 5 minutes below; whole hours alone). */
export function drivenWords(ms: number, lang: LangCode): string {
  const total = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total - h * 60 >= 5 ? Math.floor((total - h * 60) / 5) * 5 : 0;
  if (lang === 'ms') return [h ? `${h} jam` : '', m ? `${m} minit` : ''].filter(Boolean).join(' ') || `${total} minit`;
  if (lang === 'ja') return `${h ? `${h}時間` : ''}${m ? `${m}分` : ''}` || `${total}分`;
  const hh = h ? `${h} hour${h === 1 ? '' : 's'}` : '';
  const mm = m ? `${m} minutes` : '';
  return [hh, mm].filter(Boolean).join(' ') || `${total} minutes`;
}

function restLine(rest: RestAhead | null, lang: LangCode, units: Units): string {
  if (!rest) {
    if (lang === 'ms') return 'Berhenti di kawasan rehat seterusnya atau tempat yang selamat.';
    if (lang === 'ja') return '次の休憩所か、安全な場所で止まりましょう。';
    return 'Stop at the next rest area or another safe place.';
  }
  const d = LANGS[lang].spokenDistance(rest.dist, units);
  if (lang === 'ms') return `Kawasan rehat seterusnya, ${rest.name}, dalam ${d}.`;
  if (lang === 'ja') return `次の休憩所、${rest.name}まで${d}です。`;
  return `The next rest area, ${rest.name}, is in ${d}.`;
}

/** At the focus limit. */
export function limitSpeech(driven: number, rest: RestAhead | null, lang: LangCode, units: Units): string {
  const t = drivenWords(driven, lang);
  if (lang === 'ms') return `Anda telah memandu selama ${t}. Masa untuk berehat sekurang-kurangnya 15 minit. ${restLine(rest, lang, units)}`;
  if (lang === 'ja') return `運転を始めて${t}たちました。15分ほど休憩しましょう。${restLine(rest, lang, units)}`;
  return `You have been driving for ${t}. Time for a break of at least 15 minutes. ${restLine(rest, lang, units)}`;
}

/** Again after the limit, more firmly each time. */
export function remindSpeech(driven: number, level: 1 | 2 | 3, rest: RestAhead | null, lang: LangCode, units: Units): string {
  const t = drivenWords(driven, lang);
  const r = restLine(rest, lang, units);
  if (lang === 'ms') {
    if (level === 1) return `${t} tanpa rehat. Sila berehat tidak lama lagi. ${r}`;
    if (level === 2) return `${t} tanpa rehat. Memandu dalam keadaan letih sangat berbahaya. ${r}`;
    return `Anda telah memandu ${t} tanpa rehat. Sila berhenti dan berehat sekarang. Tidur sebentar selama 15 hingga 20 minit sangat membantu.`;
  }
  if (lang === 'ja') {
    if (level === 1) return `休憩なしで${t}運転しています。そろそろ休憩しましょう。${r}`;
    if (level === 2) return `休憩なしで${t}です。疲れたままの運転は危険です。${r}`;
    return `休憩なしで${t}運転しています。今すぐ止まって休んでください。15分から20分の仮眠が効果的です。`;
  }
  if (level === 1) return `${t} without a break. Please take a break soon. ${r}`;
  if (level === 2) return `${t} without a break. Driving tired is dangerous. ${r}`;
  return `You have been driving for ${t} without a break. Please stop and rest now. A 15 to 20 minute nap helps a lot.`;
}

/** The driving looks tired. */
export function drowsySpeech(signs: Sign[], lang: LangCode, rest: RestAhead | null, units: Units): string {
  const r = restLine(rest, lang, units);
  const wander = signs.includes('wander') || signs.includes('weave');
  if (lang === 'ms') return `Perhatian. ${wander ? 'Kenderaan anda kelihatan tidak stabil di lorong.' : 'Kelajuan anda tidak tetap.'} Anda mungkin semakin mengantuk. Buka tingkap, duduk tegak, dan berehat. ${r}`;
  if (lang === 'ja') return `ご注意ください。${wander ? '車線内でふらついているようです。' : '速度が不安定です。'}眠気が出ているかもしれません。窓を開けて姿勢を正し、休憩しましょう。${r}`;
  return `Stay alert. ${wander ? 'Your car seems to be wandering in the lane.' : 'Your speed keeps changing.'} You may be getting sleepy. Open a window, sit up straight, and take a break. ${r}`;
}

/** Shown when a break started the clock again. */
export function restedText(lang: LangCode): string {
  if (lang === 'ms') return 'Rehat dikira. Masa memandu bermula semula.';
  if (lang === 'ja') return '休憩しました。運転時間をリセットしました。';
  return 'Break taken. Driving time starts again.';
}

/** The words on the break chip. */
export function chipWords(lang: LangCode): { due: string; drowsy: string; find: string; driving: string } {
  if (lang === 'ms') return { due: 'Masa berehat', drowsy: 'Tanda mengantuk', find: 'Cari R&R', driving: 'Memandu' };
  if (lang === 'ja') return { due: '休憩の時間', drowsy: '眠気のサイン', find: '休憩所', driving: '運転' };
  return { due: 'Time for a break', drowsy: 'Signs of tiredness', find: 'Find R&R', driving: 'Driving' };
}

const LEADS: Record<LangCode, Record<TalkTopic, string[]>> = {
  en: {
    jokes: ['Here is a joke.', 'Joke time.', 'A quick one for you.', 'This one might make you smile.'],
    riddles: ['Riddle time. Have a think.', 'Here is a riddle.', 'Quick quiz.', 'Try this one.'],
    malaysia: ['Fun fact about Malaysia.', 'Did you know?', 'Something about home.'],
    world: ['Around the world.', 'Did you know?', 'Here is a fun fact.'],
    cars: ['Car fact.', 'For the car fans.', 'Did you know?'],
    animals: ['Animal fact.', 'From the animal world.', 'Did you know?'],
    lifehacks: ['Quick lifehack.', 'Handy tip.', 'Here is a useful trick.'],
    science: ['Science fact.', 'Here is something amazing.', 'Did you know?'],
  },
  ms: {
    jokes: ['Ini satu lawak.', 'Masa untuk lawak.', 'Satu jenaka pendek.'],
    riddles: ['Teka-teki. Cuba fikir.', 'Ini satu teka-teki.', 'Kuiz pendek.'],
    malaysia: ['Fakta menarik tentang Malaysia.', 'Tahukah anda?'],
    world: ['Di seluruh dunia.', 'Tahukah anda?'],
    cars: ['Fakta kereta.', 'Tahukah anda?'],
    animals: ['Fakta haiwan.', 'Dari dunia haiwan.'],
    lifehacks: ['Petua ringkas.', 'Tip berguna.'],
    science: ['Fakta sains.', 'Tahukah anda?'],
  },
  ja: {
    jokes: ['ジョークをひとつ。', 'ちょっと笑える話です。'],
    riddles: ['なぞなぞです。考えてみてください。', 'クイズです。'],
    malaysia: ['マレーシアの豆知識です。', 'ご存じですか。'],
    world: ['世界の豆知識です。', 'ご存じですか。'],
    cars: ['車の豆知識です。', 'ご存じですか。'],
    animals: ['動物の豆知識です。', '動物の世界から。'],
    lifehacks: ['ちょっとした生活の知恵です。', '便利なコツです。'],
    science: ['科学の豆知識です。', 'ご存じですか。'],
  },
};

/** The line before a joke, fact or riddle (varied with n). */
export function talkLead(topic: TalkTopic, lang: LangCode, n: number): string {
  const xs = LEADS[lang]?.[topic] ?? LEADS.en[topic];
  return xs[Math.abs(n) % xs.length];
}

/** Before a riddle's answer. */
export function answerLead(lang: LangCode): string {
  if (lang === 'ms') return 'Jawapannya:';
  if (lang === 'ja') return '答えは、';
  return 'The answer:';
}

/** Said with the first joke of a drive, so the driver knows why the app has started talking. */
export function talkIntro(reason: 'tired' | 'drowsy' | 'often', lang: LangCode): string {
  if (lang === 'ms') return reason === 'often' ? 'Perjalanan masih jauh. Mari berbual sedikit supaya anda kekal segar.' : 'Saya akan berbual sedikit supaya anda kekal berjaga.';
  if (lang === 'ja') return reason === 'often' ? 'まだ先は長いので、眠くならないよう少しお話しします。' : '眠くならないように、少しお話しします。';
  return reason === 'often' ? 'Long way to go. I will chat now and then to keep you fresh.' : 'I will chat a little to help you stay awake.';
}
