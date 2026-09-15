import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

/**
 * 在线发音回退测试：
 * - 系统 TTS 不可用（无 speechSynthesis）时回退到有道 mp3
 * - stopSpeak 同时停止在线音频
 * tts.ts 有模块级 voicesLoaded/cachedVoices 缓存，用 vi.resetModules() + 动态 import
 * 在每个测试里拿到全新模块，避免缓存跨用例污染。
 */

class FakeAudio {
  static instances: FakeAudio[] = [];
  src = '';
  paused = true;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  constructor() {
    FakeAudio.instances.push(this);
  }
}

type TtsModule = typeof import('@/lib/tts');

function stubSpeechSynthesis(present: boolean, voices: unknown[] = []) {
  if (!present) {
    vi.stubGlobal('speechSynthesis', undefined);
    return;
  }
  vi.stubGlobal('SpeechSynthesisUtterance', class { voice: unknown; lang = ''; rate = 1; volume = 1; });
  vi.stubGlobal('speechSynthesis', {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: vi.fn(() => voices),
    onvoiceschanged: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    speaking: false,
    pending: false,
  } as unknown as SpeechSynthesis);
}

describe('tts 在线发音回退', () => {
  beforeAll(() => {
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeAudio.instances = [];
    vi.restoreAllMocks();
  });

  async function freshTts(): Promise<TtsModule> {
    vi.resetModules();
    return import('@/lib/tts');
  }

  it('系统 TTS 不可用（手机端无 GMS / 无语音引擎）时回退有道 mp3', async () => {
    stubSpeechSynthesis(false);
    vi.stubGlobal('Audio', FakeAudio);
    const tts = await freshTts();
    const ok = tts.speak('transcend');
    expect(ok).toBe(true);
    expect(FakeAudio.instances).toHaveLength(1);
    const audio = FakeAudio.instances[0];
    expect(audio.src).toBe(
      `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent('transcend')}&type=2`,
    );
    expect(audio.play).toHaveBeenCalled();
  });

  it('系统 TTS 可用且有英文 voice 时仍走系统 TTS（桌面体验不变）', async () => {
    stubSpeechSynthesis(true, [
      { lang: 'en-US', name: 'Google US English', default: true },
    ]);
    vi.stubGlobal('Audio', FakeAudio);
    const tts = await freshTts();
    const ok = tts.speak('apple');
    expect(ok).toBe(true);
    expect(FakeAudio.instances).toHaveLength(0); // 未走有道回退
    const synth = (globalThis as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } }).speechSynthesis;
    expect(synth.speak).toHaveBeenCalled();
  });

  it('系统 TTS 存在但无英文 voice 时回退有道（国产安卓典型场景）', async () => {
    stubSpeechSynthesis(true, [{ lang: 'zh-CN', name: '普通话' }]);
    vi.stubGlobal('Audio', FakeAudio);
    const tts = await freshTts();
    const ok = tts.speak('banana');
    expect(ok).toBe(true);
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it('英音请求走 type=1，美音走 type=2', async () => {
    stubSpeechSynthesis(false);
    vi.stubGlobal('Audio', FakeAudio);
    const tts = await freshTts();
    tts.speak('transcend', { lang: 'en-GB' });
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toContain('type=1');
    // 第二次调用复用同一 Audio 单例，仅更换 src
    tts.speak('transcend', { lang: 'en-US' });
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toContain('type=2');
  });

  it('stopSpeak 同时停止系统 TTS 与在线音频', async () => {
    stubSpeechSynthesis(true, [{ lang: 'en-US', name: 'Google' }]);
    vi.stubGlobal('Audio', FakeAudio);
    const tts = await freshTts();
    tts.speak('first');
    tts.stopSpeak();
    const synth = (globalThis as unknown as { speechSynthesis: { cancel: ReturnType<typeof vi.fn> } }).speechSynthesis;
    expect(synth.cancel).toHaveBeenCalled();
  });

  it('stopSpeak 停止在线音频（回退场景）', async () => {
    stubSpeechSynthesis(false);
    vi.stubGlobal('Audio', FakeAudio);
    const tts = await freshTts();
    tts.speak('hello');
    const audio = FakeAudio.instances[0];
    tts.stopSpeak();
    expect(audio.pause).toHaveBeenCalled();
  });

  it('空文本不发音返回 false', async () => {
    stubSpeechSynthesis(false);
    vi.stubGlobal('Audio', FakeAudio);
    const tts = await freshTts();
    expect(tts.speak('')).toBe(false);
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it('isSpeechSupported 语义保持：检测系统语音合成能力', async () => {
    stubSpeechSynthesis(true, []);
    vi.stubGlobal('window', { SpeechSynthesisUtterance: class {} });
    let tts = await freshTts();
    expect(tts.isSpeechSupported()).toBe(true);
    stubSpeechSynthesis(false);
    tts = await freshTts();
    expect(tts.isSpeechSupported()).toBe(false);
  });
});
