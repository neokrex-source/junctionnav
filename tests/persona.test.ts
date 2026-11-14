import { describe, expect, it } from 'vitest';
import { Persona, PRETRIP_MIN, speechText, spokenDuration, type TripInfo } from '../src/voice/persona';
import type { TollState } from '../src/nav/tolls';
import type { TunnelState } from '../src/nav/tunnels';

const make = (over: Partial<Persona> = {}) => Object.assign(new Persona(), over);
const toll: TollState = { plaza: { id: 't', s: 0, at: [101.7, 3.1], name: 'Plaza Tol Sungai Besi' }, dist: 2000 };
const trip: TripInfo = { dest: 'Suria KLCC', duration: 70 * 60, arrival: '9:30 am', tolls: true, pay: 'tng' };

describe('how the butler addresses the driver', () => {
  it('sir, ma’am, a first name or nothing, in each language', () => {
    expect(make().word()).toBe('sir');
    expect(make({ addressAs: 'maam' }).word()).toBe('ma’am');
    expect(make({ addressAs: 'name', name: 'Anuar' }).word()).toBe('Anuar');
    expect(make({ addressAs: 'name', name: '' }).word()).toBe('');
    expect(make({ addressAs: 'none' }).word()).toBe('');
    expect(make({ lang: 'ms' }).word()).toBe('tuan');
    expect(make({ lang: 'ms', addressAs: 'maam' }).word()).toBe('puan');
    expect(make({ lang: 'ja' }).word()).toBe('旦那様');
    expect(make({ lang: 'ja', addressAs: 'name', name: 'Anuar' }).word()).toBe('Anuar様');
    expect(make({ style: 'plain' }).word()).toBe('');
  });

  it('puts the address at the end of the first sentence, or before it in Japanese', () => {
    expect(make().address('Accident ahead in 2.6 kilometres. Expect delays.')).toBe('Accident ahead in 2.6 kilometres, sir. Expect delays.');
    expect(make().address('Time for a break')).toBe('Time for a break, sir.');
    expect(make().address('Traffic news on your route: Lorry breaks down on DUKE, 3km crawl')).toBe('Traffic news on your route, sir: Lorry breaks down on DUKE, 3km crawl');
    expect(make({ lang: 'ja' }).address('この先、事故です。')).toBe('旦那様、この先、事故です。');
    expect(make({ addressAs: 'none' }).address('Accident ahead.')).toBe('Accident ahead.');
  });

  it('addresses about one turn heads-up in three, the same ones every time, never the "now" prompts', () => {
    const p = make();
    const keys = Array.from({ length: 300 }, (_, i) => `step${i}:1000`);
    const addressed = keys.filter((k) => p.maneuver('In 1 kilometre, turn left.', k, false).includes('sir'));
    expect(addressed.length).toBeGreaterThan(60);
    expect(addressed.length).toBeLessThan(140);
    expect(keys.map((k) => p.maneuver('In 1 kilometre, turn left.', k, false))).toEqual(keys.map((k) => p.maneuver('In 1 kilometre, turn left.', k, false)));
    expect(keys.every((k) => p.maneuver('Turn left now.', k, true) === 'Turn left now.')).toBe(true);
  });
});

describe('the butler’s wording', () => {
  it('speed limits and cameras', () => {
    const p = make();
    expect(p.speed({ kind: 'speedNear', key: 'a', limit: 110 }, 'a')).toBe('We’re coming up to the speed limit of 110, sir.');
    expect(p.speed({ kind: 'camera', key: 'c', limit: 90, dist: 800, over: true }, 'c')).toBe('Speed camera in 800 metres, sir. The limit is 90. I’d ease off now.');
    expect(p.speed({ kind: 'checkEnd', key: 'e', limit: null }, 'e')).toBe('That’s the end of the average speed check.');
    expect(make({ lang: 'ms' }).speed({ kind: 'speedNear', key: 'a', limit: 110 }, 'a')).toBe('Kita hampir mencapai had laju 110, tuan.');
    expect(make({ lang: 'ja' }).speed({ kind: 'speedNear', key: 'a', limit: 100 }, 'a')).toBe('旦那様、まもなく制限速度の100キロです。');
  });

  it('tolls ask for the Touch n Go card in Malaysia and the ETC card in Japan', () => {
    const p = make();
    expect(p.toll('early', toll, 'tng')).toMatch(/^.+ in 2 kilometres, sir\. Please have your Touch n Go card ready\.$/);
    expect(p.toll('mid', { ...toll, dist: 600 }, 'tng')).toBe('Toll plaza in 600 metres. Do slow down, sir, and keep to the Touch n Go lanes.');
    expect(p.toll('near', toll, 'tng')).toBe('Toll plaza just ahead, sir.');
    expect(make({ lang: 'ms' }).toll('near', toll, 'tng')).toBe('Plaza tol di hadapan, tuan.');
    expect(make({ lang: 'ja' }).toll('early', toll, 'etc')).toContain('ETCカードをご確認ください。');
  });

  it('tunnels: lights on, and guidance carries on inside long ones', () => {
    const t: TunnelState = {
      span: { id: 'x', fromS: 0, toS: 1200, length: 1200, entrance: [101.7, 3.1], name: 'SMART Tunnel', names: {} },
      phase: 'ahead',
      dist: 500,
      toExit: 1700,
      progress: 0,
    } as unknown as TunnelState;
    const text = make().tunnel(t);
    expect(text).toContain('A tunnel in 500 metres, sir: SMART Tunnel');
    expect(text).toContain('Headlights on, please.');
    expect(text).toContain('I’ll keep guiding you.');
  });

  it('arrival: a heads-up, then at the destination itself', () => {
    const p = make();
    expect(p.arrivalNear(300, 'left')).toBe('Your destination is 300 metres ahead, on the left, sir.');
    expect(p.arrived('left')).toBe('We have arrived, sir. Your destination is on your left.');
    expect(p.arrived()).toBe('We have arrived, sir.');
    expect(p.stoppedNear(120)).toBe('We’ve stopped about 100 metres from your destination, sir. I’ll end the guidance here.');
    expect(make({ lang: 'ms' }).arrived('right')).toBe('Kita sudah sampai, tuan. Destinasi di sebelah kanan.');
    expect(make({ lang: 'ja' }).arrived('left')).toBe('旦那様、到着いたしました。目的地は左側です。');
  });

  it('greets by the time of day with the trip', () => {
    expect(make().greeting(trip, 8)).toBe('Good morning, sir. Heading to Suria KLCC: about 1 hour 10 minutes, arriving around 9:30 am.');
    expect(make().greeting({ ...trip, dest: null, duration: 45 * 60 }, 20)).toBe('Good evening, sir. About 45 minutes, arriving around 9:30 am.');
    expect(make({ lang: 'ms' }).greeting(trip, 13)).toBe('Selamat tengah hari, tuan. Menuju ke Suria KLCC: kira-kira 1 jam 10 minit, tiba sekitar 9:30 am.');
    expect(make({ lang: 'ja' }).greeting(trip, 15)).toBe('こんにちは、旦那様。Suria KLCCへ向かいます。所要時間は約1時間10分、9:30 amごろ到着の予定です。');
  });

  it('newRoute and samples are the butler’s only', () => {
    expect(make().newRoute()).toBe('New route ready, sir.');
    expect(make({ style: 'plain' }).newRoute()).toBe('');
    expect(make().sample('In 300 metres, keep left.', 9)).toBe('Good morning, sir. In 300 metres, keep left.');
    expect(make({ style: 'plain' }).sample('In 300 metres, keep left.', 9)).toBe('In 300 metres, keep left.');
  });
});

describe('the check before a long drive', () => {
  it('starts above 30 minutes', () => expect(PRETRIP_MIN).toBe(1800));

  it('names the Touch n Go balance only on toll routes, then fuel and the car', () => {
    const p = make();
    expect(p.pretrip(trip)).toBe('Before we set off on a longer drive, sir, a quick check: your Touch n Go balance, that you have enough fuel, and the car itself: tyres, lights and wipers.');
    expect(p.pretrip({ ...trip, tolls: false })).not.toContain('Touch n Go');
    expect(make({ style: 'plain' }).pretrip(trip)).toBe('This is a longer drive. Before you go, check your Touch n Go balance, that you have enough fuel, and the car itself: tyres, lights and wipers.');
    expect(make({ lang: 'ms' }).pretrip(trip)).toBe('Sebelum kita memulakan perjalanan jauh ini, tuan, sila semak baki kad Touch n Go, minyak yang cukup, serta keadaan kereta: tayar, lampu dan pengelap cermin.');
    expect(make({ lang: 'ja' }).pretrip({ ...trip, pay: 'etc' })).toBe('旦那様、長めのドライブの前に、ETCカード、燃料、タイヤやライトなど車の状態をご確認ください。');
  });

  it('says durations to the minute', () => {
    expect(spokenDuration(45 * 60, 'en')).toBe('45 minutes');
    expect(spokenDuration(61 * 60, 'en')).toBe('1 hour 1 minute');
    expect(spokenDuration(120 * 60, 'en')).toBe('2 hours');
    expect(spokenDuration(70 * 60, 'ms')).toBe('1 jam 10 minit');
    expect(spokenDuration(70 * 60, 'ja')).toBe('1時間10分');
  });
});

describe('text as spoken', () => {
  it('reads destinations joined by slashes as a list', () => {
    expect(speechText('Take the exit to Kuala Lumpur / Ipoh.', 'en')).toBe('Take the exit to Kuala Lumpur and Ipoh.');
    expect(speechText('Keluar ke Kuala Lumpur / Ipoh.', 'ms')).toBe('Keluar ke Kuala Lumpur dan Ipoh.');
    expect(speechText('東京 / 横浜方面です。', 'ja')).toBe('東京、横浜方面です。');
  });
});
