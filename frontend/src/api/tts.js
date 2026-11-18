import { requestBlob } from './client';

/** Репліка AI-голосом (Gemini TTS на сервері): WAV-Blob. voice — роль чи slug учасника. */
export function fetchSpeech(text, voice, signal) {
  return requestBlob('/api/tts/', { body: { text, voice }, signal });
}
