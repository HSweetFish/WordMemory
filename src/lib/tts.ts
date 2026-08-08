/**
 * Web Speech API 发音封装
 * 优先美音，支持语速调整；浏览器不支持时静默降级。
 */

let voicesLoaded = false;
let cachedVoices: SpeechSynthesisVoice[] = [];

function loadVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const voices = speechSynthesis.getVoices();
  if (voices.length) {
    voicesLoaded = true;
    cachedVoices = voices;
  }
  return voices;
}

// Chrome 下 voices 异步加载
if (typeof speechSynthesis !== 'undefined') {
  loadVoices();
  speechSynthesis.onvoiceschanged = () => {
    voicesLoaded = true;
    cachedVoices = loadVoices();
  };
}

/** 选择美音/英音 voice */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = voicesLoaded ? cachedVoices : loadVoices();
  if (!voices.length) return null;
  const enUS = voices.find((v) => /en[-_]US/i.test(v.lang) && /google/i.test(v.name));
  const enUSAny = voices.find((v) => /en[-_]US/i.test(v.lang));
  const en = voices.find((v) => /^en/i.test(v.lang));
  return enUS || enUSAny || en || null;
}

export interface SpeakOptions {
  rate?: number;
  lang?: 'en-US' | 'en-GB';
}

/** 朗读英文文本（优先美音；voices 尚未加载完成时挂载一次性重试，规避 Chrome 首次无声） */
export function speak(text: string, opts: SpeakOptions = {}): boolean {
  if (typeof speechSynthesis === 'undefined' || !text) return false;
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utter.voice = voice;
  utter.lang = opts.lang || (voice && voice.lang) || 'en-US';
  utter.rate = opts.rate ?? 0.9;
  utter.volume = 1;
  speechSynthesis.speak(utter);
  // Chrome 首次 getVoices() 为空时直接 speak 可能无声：等 voiceschanged 后补读一次（仅未在播放时）
  if (!voicesLoaded) {
    const retry = () => {
      speechSynthesis.removeEventListener('voiceschanged', retry);
      if (speechSynthesis.speaking || speechSynthesis.pending) return;
      const v = pickVoice();
      const u = new SpeechSynthesisUtterance(text);
      if (v) u.voice = v;
      u.lang = opts.lang || (v && v.lang) || 'en-US';
      u.rate = opts.rate ?? 0.9;
      u.volume = 1;
      speechSynthesis.speak(u);
    };
    speechSynthesis.addEventListener('voiceschanged', retry);
  }
  return true;
}

/** 停止发音 */
export function stopSpeak(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/** 浏览器是否支持语音合成 */
export function isSpeechSupported(): boolean {
  return typeof speechSynthesis !== 'undefined' && 'SpeechSynthesisUtterance' in window;
}
