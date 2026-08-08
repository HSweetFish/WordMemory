import { useState } from 'react';
import { useSettings } from '@/stores/settings';
import { AI_PROVIDERS, testAiConnection } from '@/services/ai';
import { ui } from '@/lib/ui';
import type { Settings } from '@/types';

/** AI 配置表单（设置页使用）：服务商 / API Key / Base URL / 模型 + 测试连接 */
export default function AiConfigForm() {
  const { settings, set } = useSettings();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const preset = AI_PROVIDERS[settings.aiProvider] ?? AI_PROVIDERS.custom;

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const reply = await testAiConnection();
      setTestResult({ ok: true, msg: `连接成功：${reply}` });
    } catch (e) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">服务商</label>
        <select
          value={settings.aiProvider}
          onChange={(e) => {
            const id = e.target.value;
            const p = AI_PROVIDERS[id];
            set({ aiProvider: id as Settings['aiProvider'], aiBaseUrl: p?.id === 'custom' ? settings.aiBaseUrl : '', aiModel: '' });
          }}
          className={`${ui.input} w-full`}
        >
          {Object.values(AI_PROVIDERS).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">API Key</label>
        <input
          type="password"
          value={settings.aiApiKey}
          onChange={(e) => set({ aiApiKey: e.target.value })}
          placeholder="sk-..."
          autoComplete="off"
          className={`${ui.input} w-full`}
        />
        <p className="mt-1 text-xs text-slate-400">
          🔒 Key 只保存在本浏览器 localStorage，不会上传到任何服务器
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">Base URL</label>
          <input
            value={settings.aiBaseUrl || preset.baseUrl}
            onChange={(e) => set({ aiBaseUrl: e.target.value })}
            placeholder={preset.baseUrl || 'https://.../v1'}
            className={`${ui.input} w-full`}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">模型</label>
          <input
            value={settings.aiModel || preset.defaultModel}
            onChange={(e) => set({ aiModel: e.target.value })}
            placeholder={preset.defaultModel || '模型名称'}
            className={`${ui.input} w-full`}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => void runTest()}
          disabled={testing || !settings.aiApiKey.trim()}
          className={ui.btnPrimary}
        >
          {testing ? '测试中…' : '🛰️ 测试连接'}
        </button>
        {testResult && (
          <span className={`text-sm ${testResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
            {testResult.ok ? '✅' : '❌'} {testResult.msg}
          </span>
        )}
      </div>

      <p className="text-xs text-slate-400">
        💡 提示：OpenAI 官方接口不允许浏览器直连（CORS），可填入自己的代理地址；DeepSeek / 通义 / 智谱一般可直接使用。
      </p>
    </div>
  );
}
