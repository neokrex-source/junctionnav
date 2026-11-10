import { describe, expect, it } from 'vitest';
import { pickVoice, voiceGender, voicesFor, type VoiceInfo } from '../src/nav/sources';

describe('telling voices apart', () => {
  it('reads Android voice codes, gender tags and people’s names', () => {
    expect(voiceGender('en-gb-x-gbd-local')).toBe('male');
    expect(voiceGender('en-gb-x-gba-network')).toBe('female');
    expect(voiceGender('en-us-x-iom-local')).toBe('male');
    expect(voiceGender('ja-jp-x-jac-local')).toBe('male');
    expect(voiceGender('ja-jp-x-htm-local')).toBe('female');
    expect(voiceGender('en-us-x-sfg#male_1-local')).toBe('male');
    expect(voiceGender('en-us-x-sfg#female_2-local')).toBe('female');
    expect(voiceGender('Google UK English Male')).toBe('male');
    expect(voiceGender('Google UK English Female')).toBe('female');
    expect(voiceGender('Microsoft David - English (United States)')).toBe('male');
    expect(voiceGender('Microsoft Zira - English (United States)')).toBe('female');
    expect(voiceGender('Microsoft Osman Online (Natural) - Malay (Malaysia)')).toBe('male');
    expect(voiceGender('Microsoft Yasmin Online (Natural) - Malay (Malaysia)')).toBe('female');
    expect(voiceGender('Kyoko')).toBe('female');
    expect(voiceGender('Otoya')).toBe('male');
    expect(voiceGender('ms-my-x-mfm-local')).toBeNull();
  });
});

describe('picking the voice', () => {
  const v = (id: string, lang: string, local = true): VoiceInfo => ({ id, label: id, lang, gender: voiceGender(id), index: 0, local });
  const voices: VoiceInfo[] = [
    v('en-us-x-iol-local', 'en-US'),
    v('en-gb-x-gba-local', 'en-GB'),
    v('en-gb-x-gbd-network', 'en-GB', false),
    v('en-gb-x-gbd-local', 'en-GB'),
    v('ms-my-x-mfm-local', 'ms-MY'),
    v('ms-my-x-msm-network', 'ms-MY', false),
    v('ja-jp-x-htm-local', 'ja-JP'),
    v('ja-jp-x-jac-local', 'ja-JP'),
  ].map((x, index) => ({ ...x, index }));

  it('lists the language’s own region first, offline voices before online ones', () => {
    const ids = voicesFor(voices, 'en-GB').map((x) => x.id);
    expect(ids.slice(0, 3)).toEqual(['en-gb-x-gba-local', 'en-gb-x-gbd-local', 'en-gb-x-gbd-network']);
    expect(ids).toContain('en-us-x-iol-local');
    expect(voicesFor(voices, 'ms-MY').every((x) => x.lang === 'ms-MY')).toBe(true);
  });

  it('a man’s voice in the region asked for, offline first', () => {
    expect(pickVoice(voices, 'en-GB', { gender: 'male', id: '' })).toEqual({ voice: voices[3], pitch: 1 });
    expect(pickVoice(voices, 'ja-JP', { gender: 'male', id: '' }).voice?.id).toBe('ja-jp-x-jac-local');
  });

  it('a woman’s voice, or the first that is not a man’s', () => {
    expect(pickVoice(voices, 'en-GB', { gender: 'female', id: '' }).voice?.id).toBe('en-gb-x-gba-local');
    expect(pickVoice(voices, 'ms-MY', { gender: 'female', id: '' }).voice?.id).toBe('ms-my-x-mfm-local');
  });

  it('no man’s voice known for the language: the usual voice, a little lower', () => {
    expect(pickVoice(voices, 'ms-MY', { gender: 'male', id: '' })).toEqual({ voice: null, pitch: 0.8 });
  });

  it('a voice picked by name wins when it speaks the language', () => {
    expect(pickVoice(voices, 'ms-MY', { gender: 'male', id: 'ms-my-x-msm-network' })).toEqual({ voice: voices[5], pitch: 1 });
    // Picked for another language: ignored for this one.
    expect(pickVoice(voices, 'ms-MY', { gender: 'female', id: 'en-gb-x-gbd-local' }).voice?.id).toBe('ms-my-x-mfm-local');
  });
});
