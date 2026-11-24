import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  Server,
  ShieldAlert,
  Thermometer,
  Trash2,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import type { ModelConfig } from '../types';
import { PROVIDER_PRESETS } from '../data/defaults';
import { createId } from '../lib/storage';
import { testModel, userMessageForError } from '../lib/api';
import { cn } from '../lib/utils';

interface SettingsModalProps {
  open: boolean;
  configs: ModelConfig[];
  activeConfigId: string | null;
  onClose: () => void;
  onSave: (configs: ModelConfig[], activeConfigId: string | null) => void;
  onToast: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

interface TestResult {
  tone: 'success' | 'error';
  title: string;
  detail: string;
}

function createBlankConfig(): ModelConfig {
  return {
    id: createId('cfg'),
    name: '我的模型',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: '',
    temperature: 0.6,
    stream: true,
  };
}

function isValidUrl(value: string): boolean {
  if (value.startsWith('mock://')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function SettingsModal({
  open,
  configs,
  activeConfigId,
  onClose,
  onSave,
  onToast,
}: SettingsModalProps) {
  const [draftConfigs, setDraftConfigs] = useState<ModelConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftActiveId, setDraftActiveId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [validationError, setValidationError] = useState('');
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  useEffect(() => {
    if (!open) return;
    const nextConfigs = configs.map((config) => ({ ...config }));
    setDraftConfigs(nextConfigs);
    const initialId = activeConfigId || nextConfigs[0]?.id || null;
    setSelectedId(initialId);
    setDraftActiveId(activeConfigId || nextConfigs[0]?.id || null);
    setShowKey(false);
    setTestResult(null);
    setTesting(false);
    setDeleteConfirm(false);
    setValidationError('');
  }, [open, configs, activeConfigId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const selectedConfig = useMemo(
    () => draftConfigs.find((config) => config.id === selectedId) || null,
    [draftConfigs, selectedId],
  );

  if (!open) return null;

  const updateSelected = (patch: Partial<ModelConfig>) => {
    if (!selectedId) return;
    setDraftConfigs((previous) =>
      previous.map((config) => (config.id === selectedId ? { ...config, ...patch } : config)),
    );
    setTestResult(null);
    setValidationError('');
  };

  const selectConfig = (id: string) => {
    setSelectedId(id);
    setDraftActiveId(id);
    setShowKey(false);
    setDeleteConfirm(false);
    setTestResult(null);
    setValidationError('');
  };

  const addConfig = () => {
    const config = createBlankConfig();
    setDraftConfigs((previous) => [...previous, config]);
    setSelectedId(config.id);
    setDraftActiveId(config.id);
    setShowKey(true);
    setTestResult(null);
    setValidationError('');
  };

  const applyPreset = (presetId: string) => {
    const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
    if (preset) {
      updateSelected({
        baseUrl: preset.baseUrl,
        model: preset.model,
        name: preset.name,
      });
      setShowKey(true);
    }
  };

  const useDemo = () => {
    updateSelected({
      name: '演示助教',
      baseUrl: 'mock://local',
      model: 'demo-tutor',
      apiKey: '',
      stream: true,
    });
  };

  const handleDelete = () => {
    if (!selectedConfig) return;
    const remaining = draftConfigs.filter((config) => config.id !== selectedConfig.id);
    setDraftConfigs(remaining);
    const nextId = remaining[0]?.id || null;
    setSelectedId(nextId);
    setDraftActiveId((previous) =>
      previous === selectedConfig.id ? nextId : previous && remaining.some((item) => item.id === previous) ? previous : nextId,
    );
    setDeleteConfirm(false);
    setTestResult(null);
  };

  const validate = (): string => {
    if (!draftConfigs.length) return '至少添加一个模型配置，才能开始对话。';
    for (const config of draftConfigs) {
      if (!config.name.trim()) return '配置名称不能为空。';
      if (!config.baseUrl.trim()) return `配置「${config.name}」缺少 Base URL。`;
      if (!isValidUrl(config.baseUrl.trim())) {
        return `配置「${config.name}」的 Base URL 格式不正确，应以 http(s):// 或 mock:// 开头。`;
      }
      if (!config.model.trim()) return `配置「${config.name}」缺少模型名称。`;
      if (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2) {
        return `配置「${config.name}」的温度应在 0 到 2 之间。`;
      }
    }
    return '';
  };

  const handleTest = async () => {
    if (!selectedConfig) return;
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testModel(selectedConfig);
      if (selectedIdRef.current !== selectedConfig.id) return;
      setTestResult({
        tone: 'success',
        title: `连接成功 · ${result.latencyMs} ms`,
        detail: `${result.model} 返回：${result.content}`,
      });
    } catch (errorObject) {
      if (selectedIdRef.current !== selectedConfig.id) return;
      const friendly = userMessageForError(errorObject);
      setTestResult({
        tone: 'error',
        title: friendly.message,
        detail: friendly.detail,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    const cleaned = draftConfigs.map((config) => ({
      ...config,
      name: config.name.trim(),
      baseUrl: config.baseUrl.trim(),
      model: config.model.trim(),
      apiKey: config.apiKey.trim(),
    }));
    const nextActive =
      draftActiveId && cleaned.some((config) => config.id === draftActiveId)
        ? draftActiveId
        : (cleaned[0]?.id ?? null);
    onSave(cleaned, nextActive);
    onToast(cleaned.length ? '模型设置已保存。' : '已清空模型配置。', 'success');
    onClose();
  };

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-head">
          <div>
            <h2 id="settings-title">模型</h2>
            <p>接入任意 OpenAI 兼容接口，或直接使用演示模型。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭设置">
            <X size={18} />
          </button>
        </header>

        <div className="settings-body">
          <aside className="settings-list">
            <div className="settings-list-head">
              <span>配置</span>
              <button type="button" className="link-button" onClick={addConfig}>
                <Plus size={13} />
                新增
              </button>
            </div>

            <div className="settings-configs">
              {draftConfigs.map((config) => {
                const isDraftActive = config.id === draftActiveId;
                const isSavedActive = config.id === activeConfigId;
                const isSelected = config.id === selectedId;
                return (
                  <button
                    type="button"
                    key={config.id}
                    className={cn(
                      'settings-config-item',
                      isSelected && 'is-selected',
                      isDraftActive && 'is-active',
                    )}
                    onClick={() => selectConfig(config.id)}
                  >
                    <span className={cn('config-radio', isDraftActive && 'is-checked')}>
                      {isDraftActive && <Check size={11} strokeWidth={2.6} />}
                    </span>
                    <span className="settings-config-text">
                      <strong>{config.name || '未命名配置'}</strong>
                      <small>
                        {config.baseUrl.startsWith('mock://') ? '本地演示 · ' : ''}
                        {config.model || '未填写模型'}
                      </small>
                    </span>
                    {isSavedActive ? (
                      <span className="config-using">使用中</span>
                    ) : isDraftActive ? (
                      <span className="config-using is-pending">待应用</span>
                    ) : null}
                  </button>
                );
              })}
              {!draftConfigs.length && (
                <div className="settings-list-empty">
                  <Server size={20} />
                  <p>还没有模型配置</p>
                  <button type="button" className="text-button" onClick={addConfig}>
                    添加第一个配置
                  </button>
                </div>
              )}
            </div>

            <div className="security-note">
              <ShieldAlert size={13} />
              <p>
                API Key 只保存在本机浏览器。共用设备建议改用服务端 <code>.env</code>。
              </p>
            </div>
          </aside>

          <section className="settings-form">
            {selectedConfig ? (
              <>
                <div className="settings-form-head">
                  <div>
                    <h3>{selectedConfig.name || '未命名配置'}</h3>
                    <p>
                      {selectedConfig.baseUrl.startsWith('mock://')
                        ? '内置演示模型，无需网络与 Key'
                        : '兼容 OpenAI Chat Completions 协议'}
                    </p>
                  </div>
                  {selectedConfig.id === draftActiveId && (
                    <span
                      className={cn(
                        'active-badge',
                        draftActiveId !== activeConfigId && 'is-pending',
                      )}
                    >
                      <Check size={12} />
                      {draftActiveId === activeConfigId ? '当前使用' : '保存后使用'}
                    </span>
                  )}
                </div>

                <div className="preset-row">
                  <span className="field-mini-label">预设</span>
                  <div className="preset-chips">
                    {PROVIDER_PRESETS.map((preset) => (
                      <button
                        type="button"
                        key={preset.id}
                        className={cn(
                          'preset-chip',
                          selectedConfig.baseUrl === preset.baseUrl && 'is-active',
                        )}
                        onClick={() => applyPreset(preset.id)}
                      >
                        {preset.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={cn(
                        'preset-chip',
                        selectedConfig.baseUrl.startsWith('mock://') && 'is-active',
                      )}
                      onClick={useDemo}
                    >
                      本地演示
                    </button>
                  </div>
                </div>

                <div className="form-grid">
                  <label className="field">
                    <span>配置名称</span>
                    <input
                      value={selectedConfig.name}
                      onChange={(event) => updateSelected({ name: event.target.value })}
                      placeholder="例如：DeepSeek 主力"
                      maxLength={40}
                    />
                  </label>

                  <label className="field">
                    <span>模型名称</span>
                    <input
                      value={selectedConfig.model}
                      onChange={(event) => updateSelected({ model: event.target.value })}
                      placeholder="deepseek-chat / gpt-4o-mini"
                      spellCheck={false}
                    />
                  </label>

                  <label className="field field-full">
                    <span>
                      API Base URL
                      <small>可填写基础地址或完整 /chat/completions 地址</small>
                    </span>
                    <div className="input-with-icon">
                      <Server size={15} />
                      <input
                        value={selectedConfig.baseUrl}
                        onChange={(event) => updateSelected({ baseUrl: event.target.value })}
                        placeholder="https://api.deepseek.com"
                        spellCheck={false}
                        autoComplete="off"
                      />
                    </div>
                  </label>

                  <label className="field field-full">
                    <span>
                      API Key
                      <small>留空则使用服务端 .env 的 AI_API_KEY</small>
                    </span>
                    <div className="input-with-icon">
                      <KeyRound size={15} />
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={selectedConfig.apiKey}
                        onChange={(event) => updateSelected({ apiKey: event.target.value })}
                        placeholder="sk-…（仅保存在本浏览器）"
                        spellCheck={false}
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        className="input-eye"
                        onClick={() => setShowKey((value) => !value)}
                        aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                        title={showKey ? '隐藏 Key' : '显示 Key'}
                      >
                        {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </label>

                  <div className="field field-full">
                    <span className="field-label-with-icon">
                      <Thermometer size={15} />
                      温度
                      <b>{selectedConfig.temperature.toFixed(1)}</b>
                      <small>越低越稳定，越高越发散</small>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={selectedConfig.temperature}
                      onChange={(event) =>
                        updateSelected({ temperature: Number(event.target.value) })
                      }
                      className="temperature-range"
                    />
                  </div>

                  <div className="field field-full">
                    <div className="stream-toggle-row">
                      <span className="field-label-with-icon">
                        <Waves size={15} />
                        流式输出
                        <small>逐字显示，像助教正在写给你看</small>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={selectedConfig.stream}
                        className={cn('toggle', selectedConfig.stream && 'is-on')}
                        onClick={() => updateSelected({ stream: !selectedConfig.stream })}
                      >
                        <span />
                      </button>
                    </div>
                  </div>
                </div>

                {validationError && <div className="form-alert">{validationError}</div>}

                <div className="test-row">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleTest}
                    disabled={testing}
                  >
                    {testing ? <Loader2 size={15} className="spin" /> : <Zap size={15} />}
                    {testing ? '正在测试…' : '测试连接'}
                  </button>
                  {testResult && (
                    <div className={cn('test-result', `is-${testResult.tone}`)}>
                      <strong>{testResult.title}</strong>
                      {testResult.detail && <span>{testResult.detail}</span>}
                    </div>
                  )}
                </div>

                <div className="settings-form-footer">
                  {deleteConfirm ? (
                    <div className="delete-confirm">
                      <span>确认删除「{selectedConfig.name}」？</span>
                      <button type="button" className="text-button is-danger" onClick={handleDelete}>
                        删除
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setDeleteConfirm(false)}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="danger-text-button"
                      onClick={() => setDeleteConfirm(true)}
                      disabled={draftConfigs.length <= 1}
                      title={draftConfigs.length <= 1 ? '至少保留一个配置' : '删除此配置'}
                    >
                      <Trash2 size={14} />
                      删除此配置
                    </button>
                  )}
                  <div className="footer-actions">
                    <button type="button" className="ghost-button" onClick={onClose}>
                      取消
                    </button>
                    <button type="button" className="primary-button" onClick={handleSave}>
                      保存设置
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="settings-form-empty">
                <span className="empty-mark">
                  <Server size={24} />
                </span>
                <h3>先添加一个模型</h3>
                <p>支持 DeepSeek、Kimi、OpenAI、通义千问等任何 OpenAI 兼容接口。</p>
                <button type="button" className="primary-button" onClick={addConfig}>
                  <Plus size={15} />
                  新增模型配置
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
