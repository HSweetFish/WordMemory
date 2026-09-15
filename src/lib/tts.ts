/**
 * 发音封装：系统 Web Speech API + 有道在线回退
 * 优先系统语音（美音，支持语速调整）；无 API / 无英文 voice 时自动改用有道词典
 * mp3（手机端修复：国产安卓无 GMS 系统 TTS 无英文语音、iOS 自动朗读受手势限制、
 * 微信内置浏览器支持差）。有道接口无需 CORS、无需鉴权（<audio> 不受跨域限制）。
 */

let voicesLoaded = false;
let cachedVoices: SpeechSynthesisVoice[] = [];
/** 模块级在线音频单例：避免连读时多个 Audio 叠加播放 */
let onlineAudio: HTMLAudioElement | null = null;

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

/** 有道词典发音 mp3（type=2 美音 / type=1 英音），播放在线音频 */
function playYoudao(text: string, lang?: 'en-US' | 'en-GB'): boolean {
  try {
    if (typeof Audio === 'undefined' || !text) return false;
    if (!onlineAudio) onlineAudio = new Audio();
    onlineAudio.pause();
    const type = lang === 'en-GB' ? 1 : 2;
    onlineAudio.src = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${type}`;
    onlineAudio.play().catch(() => {
      /* 自动播放被拦截时静默（用户点击触发的播放通常不受限） */
    });
    return true;
  } catch {
    return false;
  }
}

export interface SpeakOptions {
  rate?: number;
  lang?: 'en-US' | 'en-GB';
}

/** 朗读英文文本：系统 TTS 可用且有英文 voice 时走原逻辑（桌面体验不变）；否则回退有道 mp3 */
export function speak(text: string, opts: SpeakOptions = {}): boolean {
  if (!text) return false;
  // 先停掉可能残留的在线音频，避免与系统语音叠加
  if (onlineAudio) onlineAudio.pause();
  // 系统 TTS 可用且能选出英文 voice → 原逻辑；否则回退在线发音
  if (typeof speechSynthesis !== 'undefined' && pickVoice()) {
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
  // 系统语音不可用 / 无英文 voice：回退有道 mp3
  return playYoudao(text, opts.lang);
}

/** 停止发音：同时停止系统 TTS 与在线音频 */
export function stopSpeak(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  if (onlineAudio) onlineAudio.pause();
}

/** 浏览器是否支持系统语音合成 */
export function isSpeechSupported(): boolean {
  return typeof speechSynthesis !== 'undefined' && 'SpeechSynthesisUtterance' in window;
}
