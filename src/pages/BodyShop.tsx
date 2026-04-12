import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Camera, FileVideo, X, AlertCircle, CheckCircle2, Loader2, Search, Package, ArrowLeft, Key, Plus, Trash2, Info, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { collection, addDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import carModelsData from '../data/car-models.json';

// ─── Firestore error handling ────────────────────────────────────────────────

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId || undefined,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// ─── Aluminum whitelist (prompt v2.0 STEP 3) ────────────────────────────────
// Show aluminum checkbox ONLY for these brands/models
const ALUMINUM_BRANDS = ['audi a8', 'jaguar', 'tesla', 'land rover'];

function shouldShowAluminum(carModel?: string, make?: string): boolean {
  const model = (carModel || '').toLowerCase();
  const brand = (make || '').toLowerCase();
  return ALUMINUM_BRANDS.some(ab => model.includes(ab) || brand.includes(ab));
}

// ─── NOTE: System prompt is now on the backend (server.ts v2.0) ─────────────
// Frontend calls /api/estimate — NO prompt needed here

import { ThemeToggle } from '../components/ThemeToggle';

export function BodyShop() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polishingType, setPolishingType] = useState<'none' | 'element' | 'few' | 'full'>('none');
  const [repairOptions, setRepairOptions] = useState<Record<number, string>>({});
  const [excludedRepairs, setExcludedRepairs] = useState<Record<number, boolean>>({});
  const [aluminumRepairs, setAluminumRepairs] = useState<Record<number, boolean>>({});
  
  const [vin, setVin] = useState('');
  const [vinData, setVinData] = useState<any>(null);
  const [manualBrand, setManualBrand] = useState('');
const [manualModel, setManualModel] = useState('');
const [manualYear, setManualYear] = useState('');
  const [isSearchingVin, setIsSearchingVin] = useState(false);
  const [selectedParts, setSelectedParts] = useState<Record<number, string>>({});
  const [manualPositions, setManualPositions] = useState<{name: string, cost: number}[]>([]);
  const [newPositionName, setNewPositionName] = useState('');
  const [newPositionCost, setNewPositionCost] = useState('');
  const [viewMode, setViewMode] = useState<'client' | 'master'>('client');

  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkApiKey = async () => {
      try {
        // @ts-ignore
        if (window.aistudio && window.aistudio.hasSelectedApiKey) {
          // @ts-ignore
          const hasKey = await window.aistudio.hasSelectedApiKey();
          setHasApiKey(hasKey);
        } else {
          setHasApiKey(true);
        }
      } catch (e) {
        setHasApiKey(true);
      }
    };
    checkApiKey();
  }, []);

  const handleSelectApiKey = async () => {
    try {
      // @ts-ignore
      if (window.aistudio && window.aistudio.openSelectKey) {
        // @ts-ignore
        await window.aistudio.openSelectKey();
        setHasApiKey(true);
      }
    } catch (e) {
      console.error("Failed to open API key selection:", e);
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setIsDragging(true);
    else if (e.type === 'dragleave') setIsDragging(false);
  }, []);

  const processFiles = (newFiles: File[]) => {
    const validFiles = newFiles.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (validFiles.length + files.length > 10) {
      setError(t('max_files'));
      return;
    }
    setFiles(prev => [...prev, ...validFiles]);
    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => setPreviews(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
    setError(null);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  }, [files]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(Array.from(e.target.files));
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const searchVin = async () => {
    if (vin.length !== 17) {
      setError(t('vin_length'));
      return;
    }
    setIsSearchingVin(true);
    setError(null);
    try {
      const res = await fetch(`/api/vin/${vin}`);
      if (!res.ok) throw new Error('Ошибка поиска VIN');
      const data = await res.json();
      if (!data.found || data.make === 'Unknown Make') {
        setError('Автомобиль не найден. Пожалуйста, введите данные вручную.');
        setVinData({ vin: vin, make: '', model: '', year: '', found: false });
      } else {
        setVinData(data);
      }
    } catch (err) {
      setError('Ошибка поиска VIN. Пожалуйста, введите данные вручную.');
      setVinData({ vin: vin, make: '', model: '', year: '', found: false });
    } finally {
      setIsSearchingVin(false);
    }
  };

  // ─── Get API key (AI Studio or env) ─────────────────────────────────────────
  const getApiKey = async (): Promise<string> => {
    try {
      // @ts-ignore — AI Studio injects this globally
      if (window.aistudio && window.aistudio.getApiKey) {
        // @ts-ignore
        return await window.aistudio.getApiKey();
      }
    } catch (e) {
      console.warn("AI Studio getApiKey not available, falling back to env");
    }
    return "";
  };

  // ─── MAIN: Call backend /api/estimate (prompt v2.0 + 3-layer routing) ─────
  const analyzeDamage = async () => {
    if (files.length === 0) {
      setError(t('upload_one'));
      return;
    }
    setIsAnalyzing(true);
    setError(null);

    try {
      // Get API key from AI Studio
      const apiKey = await getApiKey();

      // Convert files to base64
      const filesData = await Promise.all(files.map(async (file) => {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        return { data: base64, mimeType: file.type };
      }));

      // Call backend — server.ts handles model routing + prompt v3.0
      const currentLang = i18n.language?.substring(0, 2) || 'ru';
      const res = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesData, apiKey, lang: currentLang })
      });

      if (!res.ok) {
        const err = await res.json();
        if (err.error === 'quota_exceeded' || res.status === 429) {
          throw new Error('429');
        }
        if (err.error === 'invalid_api_key' || res.status === 401) {
          throw new Error('invalid_api_key');
        }
        throw new Error(err.error || 'server_error');
      }

      const raw = await res.json();
      
      // ── Safety net: guarantee all arrays exist so .map() never crashes ──
      const parsedResult = {
        ...raw,
        repairs: Array.isArray(raw.repairs) ? raw.repairs : [],
        parts: Array.isArray(raw.parts) ? raw.parts : [],
        grey_flags: Array.isArray(raw.grey_flags) ? raw.grey_flags : [],
        confidence: (raw.confidence !== null && !isNaN(raw.confidence)) ? raw.confidence : 0.9,
        totalCost: raw.totalCost || 0,
        carModel: raw.carModel || "Не определено",
        summary: raw.summary || "",
        audit_layer: raw.audit_layer || {},
      };
      setResult(parsedResult);

      // Auto-exclude non-standard types
      const initialExcluded: Record<number, boolean> = {};
      parsedResult.repairs?.forEach((r: any, idx: number) => {
        if (r.type === 'minor_adjacent' || r.type === 'frame_work' || r.type === 'internal_element' || r.type === 'minor_optional') {
          initialExcluded[idx] = true;
        }
      });
      setExcludedRepairs(initialExcluded);
      setAluminumRepairs({});

      // Save lead to CRM
      try {
        await addDoc(collection(db, 'leads'), {
          track: "body_shop",
          source: "web",
          status: "new",
          vehicleInfo: { vin: vin || "UNKNOWN", manualEntry: !vin },
          requestDetails: { description: parsedResult.summary || "Оценка кузовного ремонта" },
          estimation: parsedResult,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      } catch (e) {
        handleFirestoreError(e, OperationType.CREATE, 'leads');
      }

    } catch (err: any) {
      console.error(err);
      if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED') || err.message?.includes('quota')) {
        setError(t('quota_exceeded'));
      } else if (err.message?.includes('invalid_api_key')) {
        setError("⚠️ API KEY ERROR: Невалидный API ключ. Проверьте настройки GEMINI_API_KEY.");
      } else if (err.message?.includes('entity.too.large') || err.message?.includes('413')) {
        setError(t('file_too_large'));
      } else {
        setError(err.message || t('server_error'));
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ─── PRICING: LLM already calculated cost with multiplier — NO double multiply ─
  const calculateTotal = () => {
    if (!result) return 0;
    let total = 0;
    
    result.repairs?.forEach((repair: any, idx: number) => {
      if (excludedRepairs[idx]) return;
      
      let itemCost = repair.cost || 0;
      
      // Aluminum override: x2 (only if user toggled it)
      if (aluminumRepairs[idx]) {
        itemCost *= 2;
      }
      
      total += itemCost;
    });

    // Polishing (prompt v2.0 prices)
    if (polishingType === 'element') total += 1500;
    else if (polishingType === 'few') total += 2500;
    else if (polishingType === 'full') total += 5000;

    // Manual positions
    manualPositions.forEach(pos => total += pos.cost);
    
    return total;
  };

  const calculatePartsTotal = () => {
    if (!result?.parts || !result.parts.length) return 0;
    return result.parts.reduce((sum: number, partSearch: any, idx: number) => {
      const selectedCat = selectedParts[idx] || 'average';
      const results = Array.isArray(partSearch?.results) ? partSearch.results : [];
      if (results.length === 0) return sum;
      
      if (selectedCat === 'average') {
        const prices = results.map((r: any) => viewMode === 'master' ? r.wholesalePrice : r.retailPrice).filter((price: number) => price > 0);
        if (prices.length === 0) return sum;
        const avg = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
        return sum + Math.round(avg);
      } else {
        const selectedPart = results.find((r: any) => r.category === selectedCat);
        const price = selectedPart ? (viewMode === 'master' ? selectedPart.wholesalePrice : selectedPart.retailPrice) : 0;
        return sum + price;
      }
    }, 0);
  };

  // ─── Check if aluminum should be visible for this car ─────────────────────
  const showAluminumOption = shouldShowAluminum(result?.carModel, vinData?.make);

  if (hasApiKey === false) {
    return (
      <div className="min-h-screen p-4 md:p-8 font-sans flex items-center justify-center">
        <div className="max-w-md w-full glass-panel p-8 text-center space-y-6">
          <div className="w-16 h-16 mx-auto bg-rose-500/10 border border-rose-500/20 rounded-full flex items-center justify-center">
            <Key className="text-rose-500" size={32} />
          </div>
          <h2 className="text-xl font-bold">API Key Required</h2>
          <p className="text-zinc-400 text-sm">
            This application uses an advanced Gemini model that requires a valid API key from a paid Google Cloud project.
          </p>
          <p className="text-zinc-500 text-xs">
            For billing details, visit <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-rose-500 hover:underline">ai.google.dev/gemini-api/docs/billing</a>.
          </p>
          <button
            onClick={handleSelectApiKey}
            className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-3 px-4 rounded transition-colors"
          >
            Select API Key
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 font-sans selection:bg-rose-500/30">
      <div className="max-w-6xl mx-auto space-y-12">
        
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-zinc-800/50">
          <div>
            <button 
              onClick={() => navigate('/')}
              className="group flex items-center gap-2 text-zinc-500 hover:text-rose-500 transition-colors text-[10px] font-mono uppercase tracking-[0.2em] mb-6"
            >
              <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
              {t('back')}
            </button>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tighter gradient-text">
              {t('app_name')}
            </h1>
            <p className="text-zinc-500 mt-3 font-mono tracking-[0.3em] text-[10px] uppercase">{t('body_shop')}</p>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <div className="flex items-center gap-3 text-[10px] font-mono text-rose-500 uppercase tracking-[0.2em] border border-rose-500/20 bg-rose-500/5 px-4 py-2 rounded">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              {t('system_online')}
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-[1fr_450px] gap-8">
          <div className="space-y-6">
            
            {/* VIN Search */}
            <div className="glass-panel p-8 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-rose-500/20" />
              <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] mb-6 flex items-center gap-3 text-zinc-500">
                <Search size={14} className="text-rose-500" />
                {t('vin_search')}
              </h2>
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={vin}
                    onChange={(e) => setVin(e.target.value.toUpperCase())}
                    placeholder={t('vin_placeholder')}
                    className="w-full bg-white/50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded-lg px-6 py-4 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-rose-500/50 transition-all font-mono uppercase text-sm tracking-wider"
                    maxLength={17}
                  />
                </div>
                <button
                  onClick={searchVin}
                  disabled={isSearchingVin || vin.length !== 17}
                  className="bg-rose-600 text-white hover:bg-rose-500 px-8 py-4 rounded-lg font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-xs uppercase tracking-[0.2em] accent-glow"
                >
                  {isSearchingVin ? <Loader2 className="animate-spin" size={18} /> : t('find')}
                </button>
              </div>
              {vinData && (
                <div className="mt-6 p-5 bg-white/50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded-lg flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-300">
                  {vinData.found ? (
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
                        <CheckCircle2 className="text-rose-500" size={20} />
                      </div>
                      <div>
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">{vinData.make} {vinData.model} ({vinData.year})</p>
                        <p className="text-[10px] text-zinc-500 font-mono mt-1 tracking-wider uppercase">{vinData.vin}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 text-yellow-500 mb-2">
                        <AlertTriangle size={16} />
                        <span className="text-xs font-mono uppercase tracking-wider">Введите данные вручную</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <input
                          type="text"
                          placeholder="Марка (Make)"
                          value={vinData?.make || ''}
                          onChange={(e) => setVinData({...vinData, make: e.target.value})}
                          className="w-full bg-white/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-rose-500/50 transition-all font-mono text-xs"
                        />
                        <input
                          type="text"
                          placeholder="Модель (Model)"
                          value={vinData?.model || ''}
                          onChange={(e) => setVinData({...vinData, model: e.target.value})}
                          className="w-full bg-white/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-rose-500/50 transition-all font-mono text-xs"
                        />
                        <input
                          type="text"
                          placeholder="Год (Year)"
                          value={vinData?.year || ''}
                          onChange={(e) => setVinData({...vinData, year: e.target.value})}
                          className="w-full bg-white/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-rose-500/50 transition-all font-mono text-xs"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Manual car select — always visible */}
{!vinData?.found && (
  <div className="mt-6 space-y-3">
    <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
      Или выберите вручную
    </p>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <select
        value={manualBrand}
        onChange={(e) => { setManualBrand(e.target.value); setManualModel(''); }}
        className="bg-white/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-3 text-zinc-900 dark:text-zinc-100 font-mono text-xs"
      >
        <option value="">Марка</option>
        {Object.entries(carModelsData).map(([key, brand]: [string, any]) => (
          <option key={key} value={key}>{brand.label}</option>
        ))}
      </select>
      <select
        value={manualModel}
        onChange={(e) => setManualModel(e.target.value)}
        disabled={!manualBrand}
        className="bg-white/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-3 text-zinc-900 dark:text-zinc-100 font-mono text-xs disabled:opacity-40"
      >
        <option value="">Модель</option>
        {manualBrand && Object.entries((carModelsData as any)[manualBrand]?.models || {}).map(([key, m]: [string, any]) => (
          <option key={key} value={key}>{m.label}</option>
        ))}
      </select>
      <select
        value={manualYear}
        onChange={(e) => setManualYear(e.target.value)}
        disabled={!manualModel}
        className="bg-white/50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-3 text-zinc-900 dark:text-zinc-100 font-mono text-xs disabled:opacity-40"
      >
        <option value="">Год</option>
        {manualModel && manualBrand && (() => {
          const m = (carModelsData as any)[manualBrand]?.models?.[manualModel];
          if (!m) return null;
          const years = [];
          for (let y = m.years[1]; y >= m.years[0]; y--) years.push(y);
          return years.map(y => <option key={y} value={y}>{y}</option>);
        })()}
      </select>
    </div>
  </div>
)}
            </div>

            {/* File Upload */}
            <div className="glass-panel p-8 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-rose-500/20" />
              <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] mb-6 flex items-center gap-3 text-zinc-500">
                <Camera size={14} className="text-rose-500" />
                {t('media_damage')}
              </h2>
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`technical-border rounded-lg p-12 text-center cursor-pointer transition-all duration-300 relative group overflow-hidden ${
                  isDragging ? 'border-rose-500 bg-rose-500/5' : 'hover:border-zinc-600 hover:bg-zinc-900/30'
                }`}
              >
                {isAnalyzing && <div className="scan-line" />}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <div className="w-16 h-16 mx-auto mb-6 rounded-lg border border-zinc-800 flex items-center justify-center group-hover:border-rose-500/50 transition-colors">
                  <Upload className="text-zinc-500 group-hover:text-rose-500 transition-colors" size={24} strokeWidth={1.5} />
                </div>
                <p className="text-[11px] font-mono text-zinc-300 mb-2 uppercase tracking-[0.2em]">{t('drag_files')}</p>
                <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">{t('or_click')}</p>
                <p className="text-[9px] text-zinc-600 font-mono uppercase tracking-widest mt-4">Max 10 files (Photos/Videos)</p>
              </div>

              {previews.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mt-8">
                  {previews.map((preview, idx) => (
                    <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950">
                      {files[idx]?.type.startsWith('video/') ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                          <FileVideo className="text-rose-500/50" size={24} />
                          <span className="text-[8px] font-mono text-zinc-600 uppercase tracking-tighter">Video Data</span>
                        </div>
                      ) : (
                        <img src={preview} alt={`Preview ${idx}`} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                      )}
                      <div className="absolute inset-0 bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                      <button
                         onClick={(e) => { e.stopPropagation(); removeFile(idx); }}
                        className="absolute top-2 right-2 p-2 bg-zinc-900/80 hover:bg-rose-600 text-zinc-400 hover:text-white rounded transition-all opacity-0 group-hover:opacity-100 border border-zinc-800"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <div className="p-5 bg-rose-950/20 border border-rose-900/30 rounded-lg flex items-start gap-4 text-rose-200 animate-in fade-in slide-in-from-top-2">
                <AlertCircle size={18} className="shrink-0 mt-0.5 text-rose-500" />
                <p className="text-[11px] font-mono uppercase tracking-wider leading-relaxed">{error}</p>
              </div>
            )}

            <button
              onClick={analyzeDamage}
              disabled={isAnalyzing || files.length === 0}
              className="w-full py-5 rounded-lg font-bold text-xs uppercase tracking-[0.3em] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed bg-zinc-100 hover:bg-white text-zinc-950 accent-glow"
            >
              {isAnalyzing ? (
                <><Loader2 className="animate-spin" size={18} /> {t('analyzing')}</>
              ) : (
                <><CheckCircle2 size={18} /> {t('analyze')}</>
              )}
            </button>
          </div>

          {/* ─── RESULTS PANEL ──────────────────────────────────────────────── */}
          <div className="space-y-6">
            {result ? (
              <div className="glass-panel p-8 relative overflow-hidden animate-in fade-in slide-in-from-right-8 duration-700">
                <div className="absolute top-0 left-0 w-1 h-full bg-rose-500" />
                <div className="flex items-center justify-between mb-10">
                  <h2 className="text-[11px] font-mono uppercase tracking-[0.3em] text-zinc-400">{t('estimate')}</h2>
                  <div className="flex items-center gap-4">
                    <div className="flex bg-zinc-900/50 border border-zinc-800 rounded-lg p-1">
                      <button
                        onClick={() => setViewMode('client')}
                        className={`px-3 py-1 text-[10px] font-mono uppercase tracking-wider rounded transition-all ${
                          viewMode === 'client' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        Клиент
                      </button>
                      <button
                        onClick={() => setViewMode('master')}
                        className={`px-3 py-1 text-[10px] font-mono uppercase tracking-wider rounded transition-all ${
                          viewMode === 'master' ? 'bg-rose-500/20 text-rose-400' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        Мастер
                      </button>
                    </div>
                    <div className="px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded text-rose-500 text-[10px] uppercase tracking-[0.2em] font-mono font-bold">
                      CONFIDENCE: {(result.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>

                {/* Audit layer info (master view) */}
                {viewMode === 'master' && result.audit_layer && (
                  <div className="mb-6 p-4 bg-zinc-950/50 border border-zinc-800 rounded-lg">
                    <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider mb-1">Audit Layer</p>
                    <p className="text-[10px] font-mono text-zinc-400 leading-relaxed">
                      {result.audit_layer.multiplier_reason || result.audit_layer.reasoning}
                    </p>
                    {result.audit_layer.multiplier && (
                      <p className="text-[10px] font-mono text-rose-400 mt-1">
                        Multiplier: ×{result.audit_layer.multiplier}
                      </p>
                    )}
                  </div>
                )}

                {/* Repair items */}
                <div className="space-y-3 mb-10">
                  {result.repairs?.map((repair: any, idx: number) => {
                    const isExcluded = excludedRepairs[idx] || false;
                    const isAluminum = aluminumRepairs[idx] || false;
                    const isActive = !isExcluded;
                    const isMinorOptional = repair.type === 'minor_optional';
                    
                    // ─── COST: use LLM value directly, NO frontend multiplier ───
                    let itemCost = repair.cost || 0;
                    if (isAluminum) itemCost *= 2;

                    return (
                      <div key={idx} className={`p-5 rounded-lg border transition-all relative overflow-hidden ${
                        isMinorOptional && !isActive
                          ? 'bg-zinc-100/30 dark:bg-zinc-900/30 border-zinc-300/50 dark:border-zinc-800/50 opacity-50'
                          : isActive 
                            ? 'bg-zinc-200/50 dark:bg-zinc-900/50 border-zinc-300 dark:border-zinc-800' 
                            : 'bg-white/50 dark:bg-zinc-950/50 border-zinc-200 dark:border-zinc-900 opacity-40'
                      }`}>
                        {isActive && <div className="absolute top-0 left-0 w-1 h-full bg-rose-500/40" />}
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex items-start gap-3 mt-1">
                            <input 
                              type="checkbox" 
                              checked={isActive}
                              onChange={() => setExcludedRepairs(prev => ({ ...prev, [idx]: !prev[idx] }))}
                              className="w-4 h-4 mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-rose-500 focus:ring-rose-500 bg-white dark:bg-zinc-900 cursor-pointer"
                            />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[8px] font-mono text-rose-500/50">#{String(idx + 1).padStart(2, '0')}</span>
                              <h3 className={`text-xs font-bold uppercase tracking-wider ${isActive ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 line-through'}`}>
                                {repair.name}
                              </h3>
                              {isMinorOptional && (
                                <span className="text-[8px] font-mono px-1.5 py-0.5 bg-zinc-700/50 text-zinc-400 rounded">по желанию</span>
                              )}
                              {repair.type === 'internal_element' && (
                                <span className="text-[8px] font-mono px-1.5 py-0.5 bg-yellow-500/20 text-yellow-500 rounded">скрытый</span>
                              )}
                            </div>
                            <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-tight leading-relaxed">{repair.description}</p>
                            
                            {/* Aluminum checkbox — only for known aluminum brands */}
                            {isActive && showAluminumOption && (
                              <div className="mt-3 flex items-center gap-2">
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input 
                                    type="checkbox" 
                                    checked={isAluminum}
                                    onChange={() => setAluminumRepairs(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                    className="w-3 h-3 rounded border-zinc-300 dark:border-zinc-700 text-rose-500 focus:ring-rose-500 bg-white dark:bg-zinc-900 cursor-pointer"
                                  />
                                  <span className="text-[10px] font-mono uppercase text-zinc-400">Алюминий (x2)</span>
                                </label>
                              </div>
                            )}
                            
                            {isActive && repair.name.toLowerCase().includes('pdr') && repair.cost >= 5500 && (
                              <div className="mt-3 p-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded flex items-start gap-2">
                                <AlertTriangle size={12} className="text-yellow-500 shrink-0 mt-0.5" />
                                <p className="text-[9px] font-mono text-yellow-500/90 uppercase tracking-wider leading-relaxed">
                                  Стоимость PDR слишком высока. Возможно, понадобится обычный ремонт (рихтовка и покраска).
                                </p>
                              </div>
                            )}
                          </div>
                          <div className={`font-mono text-sm font-bold whitespace-nowrap ${isActive ? 'text-rose-500' : 'text-zinc-700'}`}>
                            {itemCost.toLocaleString()} <span className="text-[10px] opacity-50">Kč</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Grey flags */}
                {result.grey_flags && result.grey_flags.length > 0 && (
                  <div className="mb-10 space-y-2">
                    {result.grey_flags.map((flag: string, idx: number) => (
                      <div key={idx} className="p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-lg flex items-start gap-2">
                        <AlertTriangle size={12} className="text-yellow-500 shrink-0 mt-0.5" />
                        <p className="text-[9px] font-mono text-yellow-500/80 uppercase tracking-wider leading-relaxed">{flag}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Polishing (prompt v2.0 prices) */}
                <div className="mb-10 space-y-4">
                  <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.3em] flex items-center gap-3 mb-4">
                    Дополнительные услуги
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => setPolishingType(prev => prev === 'element' ? 'none' : 'element')}
                      className={`px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider border transition-all ${
                        polishingType === 'element' 
                          ? 'bg-rose-500/20 border-rose-500/50 text-rose-400' 
                          : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      Полировка 1 элемент (1 500 Kč)
                    </button>
                    <button
                      onClick={() => setPolishingType(prev => prev === 'few' ? 'none' : 'few')}
                      className={`px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider border transition-all ${
                        polishingType === 'few' 
                          ? 'bg-rose-500/20 border-rose-500/50 text-rose-400' 
                          : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      Полировка 2-3 элемента (2 500 Kč)
                    </button>
                    <button
                      onClick={() => setPolishingType(prev => prev === 'full' ? 'none' : 'full')}
                      className={`px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider border transition-all ${
                        polishingType === 'full' 
                          ? 'bg-rose-500/20 border-rose-500/50 text-rose-400' 
                          : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                      }`}
                    >
                      Полировка всего авто (от 5 000 Kč)
                    </button>
                  </div>
                </div>

                {/* Manual positions */}
                <div className="mb-10 space-y-4">
                  <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.3em] flex items-center gap-3 mb-4">
                    Ручные позиции
                  </h3>
                  
                  {manualPositions.map((pos, idx) => (
                    <div key={idx} className="p-4 rounded-lg border bg-zinc-900/50 border-zinc-800 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] font-mono text-rose-500/50">#M{String(idx + 1).padStart(2, '0')}</span>
                        <span className="text-xs font-bold uppercase tracking-wider text-zinc-100">{pos.name}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-mono text-sm font-bold text-rose-500">
                          {pos.cost.toLocaleString()} <span className="text-[10px] opacity-50">Kč</span>
                        </span>
                        <button 
                          onClick={() => setManualPositions(prev => prev.filter((_, i) => i !== idx))}
                          className="text-zinc-500 hover:text-rose-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={newPositionName}
                      onChange={(e) => setNewPositionName(e.target.value)}
                      placeholder="Название работы"
                      className="flex-1 bg-white/50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-rose-500/50 transition-all font-mono text-xs"
                    />
                    <input
                      type="number"
                      value={newPositionCost}
                      onChange={(e) => setNewPositionCost(e.target.value)}
                      placeholder="Цена (Kč)"
                      className="w-32 bg-white/50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-rose-500/50 transition-all font-mono text-xs"
                    />
                    <button
                      onClick={() => {
                        if (newPositionName && newPositionCost) {
                          setManualPositions(prev => [...prev, { name: newPositionName, cost: Number(newPositionCost) }]);
                          setNewPositionName('');
                          setNewPositionCost('');
                        }
                      }}
                      disabled={!newPositionName || !newPositionCost}
                      className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-100 rounded-lg transition-colors flex items-center justify-center"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>

                {/* Parts */}
                {result.parts && result.parts.length > 0 && (
                  <div className="mb-10 space-y-4">
                    <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.3em] flex items-center gap-3 mb-6">
                      <Package size={14} className="text-rose-500" />
                      {t('parts_estimate')}
                    </h3>
                    {result.parts.map((partSearch: any, idx: number) => {
                      const results = Array.isArray(partSearch?.results) ? partSearch.results : [];
                      const getPart = (cat: string) => results.find((r: any) => r.category === cat);
                      const options = [
                        { cat: 'new_original', label: t('new_original') },
                        { cat: 'good_aftermarket', label: t('good_aftermarket') },
                        { cat: 'average_aftermarket', label: t('average_aftermarket') },
                        { cat: 'cheap_aftermarket', label: t('cheap_aftermarket') },
                        { cat: 'used_original', label: t('used_original') }
                      ];

                      return (
                        <div key={idx} className="p-5 rounded-lg bg-white/50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800">
                          <h4 className="text-[11px] font-bold text-zinc-900 dark:text-zinc-100 mb-4 uppercase tracking-wider">{partSearch.partName}</h4>
                          <div className="space-y-2.5">
                            {/* Average price option */}
                            {(() => {
                              const isSelected = (selectedParts[idx] || 'average') === 'average';
                              const prices = results.map((r: any) => viewMode === 'master' ? r.wholesalePrice : r.retailPrice).filter((price: number) => price > 0);
                              const avg = prices.length > 0 ? Math.round(prices.reduce((a: number, b: number) => a + b, 0) / prices.length) : 0;
                              
                              return (
                                <div 
                                  className={`flex justify-between items-center group p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-rose-500/10 border border-rose-500/20' : 'hover:bg-zinc-800/30 border border-transparent'}`}
                                  onClick={() => setSelectedParts(prev => ({ ...prev, [idx]: 'average' }))}
                                >
                                  <div className="flex flex-col">
                                    <span className={`text-[10px] font-mono uppercase tracking-tighter transition-colors ${isSelected ? 'text-rose-400' : 'text-zinc-500 group-hover:text-zinc-400'}`}>Средняя цена</span>
                                  </div>
                                  <div className="flex flex-col items-end">
                                    <span className={`text-[11px] font-mono font-bold ${isSelected ? 'text-rose-400' : 'text-zinc-300'}`}>{avg.toLocaleString()} <span className="text-[9px] opacity-40">Kč</span></span>
                                  </div>
                                </div>
                              );
                            })()}
                            {options.map(opt => {
                              const part = getPart(opt.cat);
                              if (!part) return null;
                              const isSelected = (selectedParts[idx] || 'average') === opt.cat;
                              return (
                                <div 
                                  key={opt.cat} 
                                  className={`flex justify-between items-start group p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-rose-500/10 border border-rose-500/20' : 'hover:bg-zinc-800/30 border border-transparent'}`}
                                  onClick={() => setSelectedParts(prev => ({ ...prev, [idx]: opt.cat }))}
                                >
                                  <div className="flex flex-col">
                                    <span className={`text-[10px] font-mono uppercase tracking-tighter transition-colors ${isSelected ? 'text-rose-400' : 'text-zinc-500 group-hover:text-zinc-400'}`}>{opt.label}</span>
                                    {viewMode === 'master' && part.link && (
                                      <a href={part.link} target="_blank" rel="noreferrer" className="text-[8px] text-rose-500/70 hover:text-rose-400 font-mono mt-0.5 truncate max-w-[200px]" onClick={e => e.stopPropagation()}>
                                        {part.partNumber || 'Link'} ↗
                                      </a>
                                    )}
                                  </div>
                                  <div className="flex flex-col items-end gap-1">
                                    {viewMode === 'master' ? (
                                      <>
                                        <span className={`text-[11px] font-mono font-bold ${isSelected ? 'text-rose-400' : 'text-zinc-300'}`}>
                                          <span className="text-zinc-500 text-[9px] mr-2 font-normal">Опт:</span>
                                          {part.wholesalePrice?.toLocaleString()} <span className="text-[9px] opacity-40">Kč</span>
                                        </span>
                                        <span className={`text-[9px] font-mono ${isSelected ? 'text-rose-400/70' : 'text-zinc-500'}`}>
                                          <span className="mr-2">Розница:</span>
                                          {part.retailPrice?.toLocaleString()} <span className="text-[8px] opacity-40">Kč</span>
                                        </span>
                                      </>
                                    ) : (
                                      <span className={`text-[11px] font-mono font-bold ${isSelected ? 'text-rose-400' : 'text-zinc-300'}`}>
                                        {part.retailPrice?.toLocaleString()} <span className="text-[9px] opacity-40">Kč</span>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Totals */}
                <div className="pt-8 border-t border-zinc-800/50 space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">{t('labor')}</span>
                    <span className="text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100">{calculateTotal().toLocaleString()} <span className="text-xs opacity-40">Kč</span></span>
                  </div>
                  {result.parts && result.parts.length > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">{t('parts')}</span>
                      <span className="text-lg font-bold font-mono text-zinc-400">{calculatePartsTotal().toLocaleString()} <span className="text-xs opacity-40">Kč</span></span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-6 border-t border-zinc-800">
                    <span className="text-xs font-mono uppercase tracking-[0.3em] text-rose-500 font-bold">{t('total')}</span>
                    <span className="text-3xl font-bold font-mono text-zinc-900 dark:text-white accent-text">{(calculateTotal() + calculatePartsTotal()).toLocaleString()} <span className="text-sm opacity-40">Kč</span></span>
                  </div>
                  
                  <div className="pt-6 space-y-2">
                    <div className="flex items-start gap-2 text-zinc-500">
                      <Info size={12} className="shrink-0 mt-0.5" />
                      <p className="text-[9px] font-mono uppercase tracking-wider leading-relaxed">
                        Данная стоимость — только за работу. Запчасти и расходные материалы оплачиваются отдельно.
                      </p>
                    </div>
                    <div className="flex items-start gap-2 text-zinc-500">
                      <Info size={12} className="shrink-0 mt-0.5" />
                      <p className="text-[9px] font-mono uppercase tracking-wider leading-relaxed">
                        Оценка осуществляется посредством ИИ и носит предварительный характер.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="glass-panel p-12 flex flex-col items-center justify-center text-center h-full min-h-[500px] technical-border">
                <div className="w-16 h-16 rounded-lg border border-zinc-800 flex items-center justify-center mb-6">
                  <AlertCircle className="text-zinc-700" size={24} strokeWidth={1.5} />
                </div>
                <h3 className="text-[11px] font-mono uppercase tracking-[0.3em] text-zinc-500 mb-3">{t('waiting_data')}</h3>
                <p className="text-[10px] text-zinc-600 font-mono uppercase tracking-widest max-w-[200px] leading-relaxed">{t('upload_prompt')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
