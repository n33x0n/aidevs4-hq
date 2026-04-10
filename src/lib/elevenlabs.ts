// ElevenLabs — TTS + STT klient
//
// TTS: eleven_multilingual_v2 (najlepsza obsługa polskiego)
// STT: scribe_v1
// TTS jest cache'owane na dysku — generujemy raz, potem reuse.

import { createHash } from 'crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { debugLog } from './debug-log';

const API_KEY = import.meta.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE_ID = import.meta.env.ELEVENLABS_VOICE_ID || '69LnOzD6oSd1FMFoMGJr';
const TTS_MODEL = 'eleven_v3';
const STT_MODEL = 'scribe_v1';
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

const CACHE_DIR = resolve(process.cwd(), 'src/cache/tts');

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(text: string, voiceId: string, modelId: string, settings?: object): string {
  const s = settings ? JSON.stringify(settings) : '';
  return createHash('sha1').update(`${voiceId}|${modelId}|${s}|${text}`).digest('hex');
}

// ── Text-to-Speech ───────────────────────────────────────────────────────────

export interface TTSOptions {
  voiceId?: string;
  modelId?: string;
  /** Wymusza nowe wygenerowanie nawet jeśli istnieje w cache */
  noCache?: boolean;
  /** Ustawienia głosu */
  stability?: number;
  similarityBoost?: number;
  style?: number;
  /** Format wyjścia ElevenLabs */
  outputFormat?: string;
}

export async function tts(text: string, opts: TTSOptions = {}): Promise<Buffer> {
  if (!API_KEY) throw new Error('ELEVENLABS_API_KEY missing in env');

  const voiceId = opts.voiceId || DEFAULT_VOICE_ID;
  const modelId = opts.modelId || TTS_MODEL;
  const outputFormat = opts.outputFormat || DEFAULT_OUTPUT_FORMAT;
  const settings = {
    stability: opts.stability ?? 0.5,
    similarity_boost: opts.similarityBoost ?? 0.75,
    style: opts.style ?? 0.0,
    use_speaker_boost: true,
  };
  // Cache key uwzględnia też format
  const key = cacheKey(text, voiceId, modelId, { ...settings, _fmt: outputFormat });
  const cachePath = resolve(CACHE_DIR, `${key}.mp3`);

  // Cache hit
  if (!opts.noCache && existsSync(cachePath)) {
    const buf = readFileSync(cachePath);
    debugLog('elevenlabs', `TTS cache HIT (${buf.length}B): "${text.slice(0, 60)}..."`);
    return buf;
  }

  debugLog('elevenlabs', `TTS REQ: voice=${voiceId} model=${modelId} text="${text.slice(0, 60)}..."`);

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`;
  const body = {
    text,
    model_id: modelId,
    voice_settings: settings,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    debugLog('elevenlabs', `TTS ERROR ${res.status}: ${errText.slice(0, 200)}`);
    throw new Error(`ElevenLabs TTS HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  ensureCacheDir();
  writeFileSync(cachePath, buf);
  debugLog('elevenlabs', `TTS OK: ${buf.length}B → ${cachePath}`);
  return buf;
}

// ── Speech-to-Text ───────────────────────────────────────────────────────────

export interface STTOptions {
  modelId?: string;
  languageCode?: string;
  /** Tag/prefix do logu (np. nr tury) */
  tag?: string;
}

export interface STTResult {
  text: string;
  languageCode?: string;
  languageProbability?: number;
  raw: any;
}

export async function stt(audio: Buffer, opts: STTOptions = {}): Promise<STTResult> {
  if (!API_KEY) throw new Error('ELEVENLABS_API_KEY missing in env');

  const modelId = opts.modelId || STT_MODEL;
  const languageCode = opts.languageCode || 'pol';
  const tag = opts.tag ? `[${opts.tag}] ` : '';

  debugLog('elevenlabs', `${tag}STT REQ: model=${modelId} lang=${languageCode} bytes=${audio.length}`);

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'audio.mp3');
  form.append('model_id', modelId);
  form.append('language_code', languageCode);

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    debugLog('elevenlabs', `${tag}STT ERROR ${res.status}: ${errText.slice(0, 200)}`);
    throw new Error(`ElevenLabs STT HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json: any = await res.json();
  const text = json.text || '';
  debugLog('elevenlabs', `${tag}STT OK: "${text.slice(0, 120)}"`);

  return {
    text,
    languageCode: json.language_code,
    languageProbability: json.language_probability,
    raw: json,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function audioToBase64(buf: Buffer): string {
  return buf.toString('base64');
}

export function base64ToAudio(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}
