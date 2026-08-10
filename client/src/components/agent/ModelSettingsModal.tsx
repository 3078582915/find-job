import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import * as api from '../../services/api';
import type { AgentModelConfig } from '../../types';

type Provider = AgentModelConfig['provider'];

const PRESETS: Record<Exclude<Provider, 'custom'>, { model: string; baseUrl: string }> = {
  deepseek: { model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com' },
  openai: { model: 'gpt-4.1-mini', baseUrl: '' },
};

interface ModelSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onConfigured: (config: AgentModelConfig) => void;
}

function errorMessage(reason: any) {
  return reason?.response?.data?.error || reason?.message || '操作失败';
}

export default function ModelSettingsModal({ open, onClose, onConfigured }: ModelSettingsModalProps) {
  const [config, setConfig] = useState<AgentModelConfig | null>(null);
  const [provider, setProvider] = useState<Provider>('deepseek');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(PRESETS.deepseek.model);
  const [baseUrl, setBaseUrl] = useState(PRESETS.deepseek.baseUrl);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    setSuccess('');
    api.fetchAgentConfig()
      .then((value) => {
        setConfig(value);
        const initialProvider = value.configured ? value.provider : 'deepseek';
        setProvider(initialProvider);
        if (!value.configured) {
          setModel(PRESETS.deepseek.model);
          setBaseUrl(PRESETS.deepseek.baseUrl);
        } else {
          setModel(value.model);
          setBaseUrl(value.baseUrl || '');
        }
        setApiKey('');
      })
      .catch((reason) => setError(errorMessage(reason)))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const selectProvider = (next: Provider) => {
    setProvider(next);
    setError('');
    setSuccess('');
    if (next !== 'custom') {
      setModel(PRESETS[next].model);
      setBaseUrl(PRESETS[next].baseUrl);
    }
  };

  const save = async () => {
    if (!model.trim()) return setError('请填写模型名称');
    if (!apiKey.trim() && !config?.apiKeyConfigured) return setError('请填写 API Key');
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const next = await api.updateAgentConfig({
        apiKey: apiKey.trim() || undefined,
        model: model.trim(),
        baseUrl: baseUrl.trim(),
      });
      setConfig(next);
      setApiKey('');
      onConfigured(next);
      setSuccess('配置已保存，已立即生效');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setError('');
    setSuccess('');
    try {
      const result = await api.testAgentConfig();
      setSuccess(`连接成功，耗时 ${result.latencyMs} ms`);
    } catch (reason) {
      setError(`连接失败：${errorMessage(reason)}`);
    } finally {
      setTesting(false);
    }
  };

  const clearKey = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const next = await api.clearAgentApiKey();
      setConfig(next);
      setApiKey('');
      onConfigured(next);
      setSuccess(next.configured ? '界面保存的 Key 已清除，当前仍在使用环境变量' : 'API Key 已清除');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-[#10283D]/45 p-4" role="dialog" aria-modal="true" aria-label="模型设置">
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-[620px] overflow-y-auto rounded-md border border-[#D7E0E7] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E3E8EC] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#17324D]">模型设置</h2>
            <p className="mt-1 text-xs text-[#71818E]">配置仅保存在本机后端，不会回传已保存 Key 的明文</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-[#71818E] hover:bg-[#F0F3F5]" title="关闭">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-accent" /></div>
        ) : (
          <div className="space-y-5 p-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#29445C]">服务商</label>
              <div className="grid grid-cols-3 rounded-md border border-[#CCD7DF] bg-[#F5F7F9] p-1">
                {([
                  ['deepseek', 'DeepSeek'],
                  ['openai', 'OpenAI'],
                  ['custom', '自定义'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => selectProvider(value)}
                    className={`h-9 rounded text-sm font-medium ${provider === value ? 'bg-white text-[#17324D] shadow-sm' : 'text-[#71818E] hover:text-[#39536A]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="agent-base-url" className="mb-2 flex items-center gap-2 text-sm font-medium text-[#29445C]"><Server size={15} />服务地址</label>
              <input
                id="agent-base-url"
                value={baseUrl}
                onChange={(event) => { setBaseUrl(event.target.value); setProvider('custom'); }}
                placeholder="https://api.example.com/v1"
                className="h-11 w-full rounded-md border border-[#CCD7DF] px-3 text-sm text-[#17324D] outline-none focus:border-[#6C879A]"
              />
              {provider === 'openai' && <p className="mt-1.5 text-xs text-[#82909B]">OpenAI 官方服务可留空</p>}
            </div>

            <div>
              <label htmlFor="agent-model" className="mb-2 block text-sm font-medium text-[#29445C]">模型名称</label>
              <input
                id="agent-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="deepseek-chat"
                className="h-11 w-full rounded-md border border-[#CCD7DF] px-3 text-sm text-[#17324D] outline-none focus:border-[#6C879A]"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="agent-api-key" className="flex items-center gap-2 text-sm font-medium text-[#29445C]"><KeyRound size={15} />API Key</label>
                {config?.apiKeyConfigured && <span className="text-xs text-[#17865D]">已配置 {config.keyHint}</span>}
              </div>
              <div className="relative">
                <input
                  id="agent-api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  autoComplete="new-password"
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={config?.apiKeyConfigured ? '留空则保留现有 Key' : '填写 API Key'}
                  className="h-11 w-full rounded-md border border-[#CCD7DF] px-3 pr-11 text-sm text-[#17324D] outline-none focus:border-[#6C879A]"
                />
                <button type="button" onClick={() => setShowKey((value) => !value)} className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded text-[#71818E] hover:bg-[#F3F5F7]" title={showKey ? '隐藏 Key' : '显示 Key'}>
                  {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {error && <div className="flex items-start gap-2 rounded-md border border-[#F1C7B5] bg-[#FFF8F4] px-3 py-2.5 text-sm text-[#9A412B]"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}
            {success && <div className="flex items-start gap-2 rounded-md border border-[#BFE4D4] bg-[#F2FBF7] px-3 py-2.5 text-sm text-[#177252]"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{success}</div>}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E3E8EC] pt-4">
              <button
                type="button"
                onClick={clearKey}
                disabled={!config?.apiKeyConfigured || saving}
                className="inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm text-[#A54B3B] hover:bg-[#FFF3EF] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={15} />清除 Key
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={!config?.configured || testing || saving}
                  className="h-10 rounded-md border border-[#CCD7DF] px-4 text-sm font-medium text-[#39536A] hover:bg-[#F6F8F9] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {testing ? '测试中…' : '测试连接'}
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || testing}
                  className="inline-flex h-10 min-w-[92px] items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-[#EB5C2A] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : '保存配置'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
