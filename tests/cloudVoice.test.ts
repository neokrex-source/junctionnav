import { describe, expect, it, vi } from 'vitest';
import { CloudError, CloudTts, cloudTier, cloudVoicesFor, pickCloudVoice, type CloudVoice } from '../src/voice/cloud';

const voices: CloudVoice[] = [
  { name: 'en-GB-Standard-B', languageCodes: ['en-GB'], ssmlGender: 'MALE' },
  { name: 'en-GB-Wavenet-B', languageCodes: ['en-GB'], ssmlGender: 'MALE' },
  { name: 'en-GB-Neural2-B', languageCodes: ['en-GB'], ssmlGender: 'MALE' },
  { name: 'en-GB-Studio-B', languageCodes: ['en-GB'], ssmlGender: 'MALE' },
  { name: 'en-GB-Chirp3-HD-Puck', languageCodes: ['en-GB'], ssmlGender: 'MALE' },
  { name: 'en-GB-Chirp3-HD-Charon', languageCodes: ['en-GB'], ssmlGender: 'MALE' },
  { name: 'en-GB-Chirp3-HD-Aoede', languageCodes: ['en-GB'], ssmlGender: 'FEMALE' },
  { name: 'en-GB-Chirp3-HD-Kore', languageCodes: ['en-GB'], ssmlGender: 'FEMALE' },
  { name: 'en-US-Chirp3-HD-Charon', languageCodes: ['en-US'], ssmlGender: 'MALE' },
  { name: 'ms-MY-Wavenet-A', languageCodes: ['ms-MY'], ssmlGender: 'FEMALE' },
  { name: 'ms-MY-Wavenet-B', languageCodes: ['ms-MY'], ssmlGender: 'MALE' },
  { name: 'ms-MY-Standard-B', languageCodes: ['ms-MY'], ssmlGender: 'MALE' },
];

describe('picking Google’s voice', () => {
  it('ranks Chirp 3 HD, Neural2, WaveNet, Standard and leaves out Studio', () => {
    expect(cloudTier('en-GB-Chirp3-HD-Charon')).toBeGreaterThan(cloudTier('en-GB-Neural2-B'));
    expect(cloudTier('en-GB-Neural2-B')).toBeGreaterThan(cloudTier('en-GB-Wavenet-B'));
    expect(cloudTier('en-GB-Studio-B')).toBe(0);
    const names = cloudVoicesFor(voices, 'en-GB').map((v) => v.name);
    expect(names).not.toContain('en-GB-Studio-B');
    expect(names.indexOf('en-GB-Chirp3-HD-Charon')).toBeLessThan(names.indexOf('en-US-Chirp3-HD-Charon'));
  });

  it('a calm voice of the gender asked for, in the region asked for', () => {
    expect(pickCloudVoice(voices, 'en-GB', 'male')?.name).toBe('en-GB-Chirp3-HD-Charon');
    expect(pickCloudVoice(voices, 'en-GB', 'female')?.name).toBe('en-GB-Chirp3-HD-Kore');
    expect(pickCloudVoice(voices, 'ms-MY', 'male')?.name).toBe('ms-MY-Wavenet-B');
    expect(pickCloudVoice(voices, 'en-GB', 'female', 'en-GB-Chirp3-HD-Aoede')?.name).toBe('en-GB-Chirp3-HD-Aoede');
    expect(pickCloudVoice(voices, 'ja-JP', 'male')).toBeNull();
  });
});

describe('fetching Google’s voice', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('asks once per text, sends the voice and text, decodes the audio', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/voices')) return ok({ voices });
      expect(u).toContain('/text:synthesize?key=KEY');
      const body = JSON.parse(String(init?.body));
      expect(body.voice).toEqual({ languageCode: 'en-GB', name: 'en-GB-Chirp3-HD-Charon' });
      expect(body.input.text).toBe('We have arrived, sir.');
      return ok({ audioContent: btoa('ID3fake') });
    });
    const tts = new CloudTts(() => 'KEY', fetchFn as unknown as typeof fetch);
    const v = pickCloudVoice(await tts.voices('en-GB'), 'en-GB', 'male')!;
    const a = await tts.synth('We have arrived, sir.', v, 'en-GB');
    const b = await tts.synth('We have arrived, sir.', v, 'en-GB');
    expect(new TextDecoder().decode(a)).toBe('ID3fake');
    expect(b).toBe(a);
    expect(fetchFn.mock.calls.filter((c) => String(c[0]).includes('synthesize'))).toHaveLength(1);
  });

  it('tells a disabled API and a refused key apart', async () => {
    const disabled = new CloudTts(() => 'KEY', (async () => new Response('{"error":{"status":"PERMISSION_DENIED","message":"Cloud Text-to-Speech API has not been used in project 1 before or it is disabled.","details":[{"reason":"SERVICE_DISABLED"}]}}', { status: 403 })) as unknown as typeof fetch);
    await expect(disabled.voices('en-GB')).rejects.toMatchObject({ problem: 'api' });
    const refused = new CloudTts(() => 'KEY', (async () => new Response('{"error":{"status":"PERMISSION_DENIED","message":"Requests to this API are blocked."}}', { status: 403 })) as unknown as typeof fetch);
    await expect(refused.voices('en-GB')).rejects.toMatchObject({ problem: 'key' });
    const none = new CloudTts(() => '', fetch);
    await expect(none.voices('en-GB')).rejects.toBeInstanceOf(CloudError);
  });
});
