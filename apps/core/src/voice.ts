import type { Aether } from './types.js';

/** Server-side speech-to-text (used when the browser has no Web Speech API, e.g. some iOS PWAs). */
export async function transcribe(a: Aether, audio: Buffer, mime: string): Promise<{ text: string; provider: string }> {
  const s = (await a.settings.get()).voice;
  const pick = async () => {
    if (s.stt === 'groq' && (await a.vault.get('GROQ_API_KEY'))) return { url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: (await a.vault.get('GROQ_API_KEY'))!, model: 'whisper-large-v3-turbo', provider: 'groq' };
    if (await a.vault.get('OPENAI_API_KEY')) return { url: 'https://api.openai.com/v1/audio/transcriptions', key: (await a.vault.get('OPENAI_API_KEY'))!, model: 'gpt-4o-mini-transcribe', provider: 'openai' };
    if (await a.vault.get('GROQ_API_KEY')) return { url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: (await a.vault.get('GROQ_API_KEY'))!, model: 'whisper-large-v3-turbo', provider: 'groq' };
    return null;
  };
  const p = await pick();
  if (!p) throw new Error('Server transcription needs OPENAI_API_KEY or GROQ_API_KEY in the vault. The browser microphone (Web Speech) works without keys in Safari and Chrome.');
  const ext = mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `speech.${ext}`);
  form.append('model', p.model);
  const res = await fetch(p.url, { method: 'POST', headers: { authorization: `Bearer ${p.key}` }, body: form });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Transcription failed (${p.provider} ${res.status}): ${j.error?.message ?? ''}`);
  return { text: String(j.text ?? '').trim(), provider: p.provider };
}

/** Text-to-speech through xAI, OpenAI or ElevenLabs. Returns null when the browser voice should be used. */
export async function synthesize(a: Aether, text: string, voiceOverride?: string): Promise<{ audio: Buffer; mime: string; provider: string } | null> {
  const s = (await a.settings.get()).voice;
  const input = text.replace(/[*_`#>]/g, '').slice(0, 1500);
  if (!input.trim() || s.tts === 'browser' || s.tts === 'off') return null;
  const voice = voiceOverride || s.voice;
  if (s.tts === 'xai') {
    const key = await a.vault.get('XAI_API_KEY');
    if (!key) return null;
    const res = await fetch('https://api.x.ai/v1/tts', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: input, voice_id: voice || 'eve', language: 'en' }) });
    if (!res.ok) throw new Error(`xAI TTS ${res.status}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') || 'audio/mpeg', provider: 'xai' };
  }
  if (s.tts === 'openai') {
    const key = await a.vault.get('OPENAI_API_KEY');
    if (!key) return null;
    const res = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'].includes(voice) ? voice : 'alloy', input, response_format: 'mp3' }) });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg', provider: 'openai' };
  }
  if (s.tts === 'elevenlabs') {
    const key = await a.vault.get('ELEVENLABS_API_KEY');
    if (!key) return null;
    const vid = /^[A-Za-z0-9]{20}$/.test(voice) ? voice : '21m00Tcm4TlvDq8ikWAM';
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}`, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify({ text: input, model_id: 'eleven_turbo_v2_5' }) });
    if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mime: 'audio/mpeg', provider: 'elevenlabs' };
  }
  return null;
}
