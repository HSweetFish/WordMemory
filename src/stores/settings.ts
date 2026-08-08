import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Settings } from '@/types';

const DEFAULT_SETTINGS: Settings = {
  dailyNewLimit: 20,
  dailyReviewLimit: 100,
  groupSize: 10,
  activeBooks: [],
  aiProvider: 'openai',
  aiApiKey: '',
  aiBaseUrl: '',
  aiModel: '',
  darkMode: false,
  // 自动朗读默认关闭：翻卡时逐张自动发音体验不佳（且浏览器语音质量一般），
  // 需要听发音时点卡片上的 🔊 按钮即可；想恢复自动朗读可在设置里打开。
  autoSpeak: false,
  reminderTime: '',
};

interface SettingsState {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
  /** 重置除 AI 配置（服务商 / Key / Base URL / 模型）外的所有设置为默认值 */
  resetExceptAi: () => void;
}

/**
 * 设置状态（持久化到 localStorage）
 * 注意：AI API Key 仅存浏览器本地，不上传任何服务器。
 */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      settings: { ...DEFAULT_SETTINGS },
      set: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      reset: () => set({ settings: { ...DEFAULT_SETTINGS } }),
      resetExceptAi: () =>
        set((s) => ({
          settings: {
            ...DEFAULT_SETTINGS,
            aiProvider: s.settings.aiProvider,
            aiApiKey: s.settings.aiApiKey,
            aiBaseUrl: s.settings.aiBaseUrl,
            aiModel: s.settings.aiModel,
          },
        })),
    }),
    {
      name: 'wordmemory-settings',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);

export { DEFAULT_SETTINGS };
