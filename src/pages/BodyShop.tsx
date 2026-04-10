import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, Camera, FileVideo, X, AlertCircle, CheckCircle2, Loader2, Search, Package, ArrowLeft, Key, Plus, Trash2, Info, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { collection, addDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { ThemeToggle } from '../components/ThemeToggle';

// --- Aluminum whitelist ---
const ALUMINUM_BRANDS = ['audi a8', 'jaguar', 'tesla', 'land rover'];
function shouldShowAluminum(carModel?: string, make?: string): boolean {
  const model = (carModel || '').toLowerCase();
  const brand = (make || '').toLowerCase();
  return ALUMINUM_BRANDS.some(ab => model.includes(ab) || brand.includes(ab));
}

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
  const [excludedRepairs, setExcludedRepairs] = useState<Record<number, boolean>>({});
  const [aluminumRepairs, setAluminumRepairs] = useState<Record<number, boolean>>({});
  const [selectedParts, setSelectedParts] = useState<Record<number, string>>({});
  
  const [vin, setVin] = useState('');
  const [vinData, setVinData] = useState<any>(null);
  const [isSearchingVin, setIsSearchingVin] = useState(false);

  const [manualPositions, setManualPositions] = useState<{name: string, cost: number}[]>([]);
  const [newPositionName, setNewPositionName] = useState('');
  const [newPositionCost, setNewPositionCost] = useState('');
  const [viewMode, setViewMode] = useState<'client' | 'master'>('client');

  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setIsDragging(false);
    if (e.dataTransfer.files?.length) processFiles(Array.from(e.dataTransfer.files));
  }, [files]);

  const searchVin = async () => {
    if (vin.length !== 17) return setError(t('vin_length'));
    setIsSearchingVin(true);
    setError(null);
    try {
      const res = await fetch(`/api/vin/${vin}`);
      const data = await res.json();
      if (!res.ok || !data.found) {
        setError(t('vin_error'));
        setVinData({ vin, make: '', model: '', year: '', found: false });
      } else {
        setVinData(data);
      }
    } catch (err) {
      setError('VIN API Error');
    } finally { setIsSearchingVin(false); }
  };

  const analyzeDamage = async () => {
    if (files.length === 0) return setError(t('upload_one'));
    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const filesData = await Promise.all(files.map(async (file) => {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
        return { data: base64, mimeType: file.type };
      }));

      const res = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          files: filesData, 
          lang: i18n.language 
        })
      });

      const parsedResult = await res.json();
      if (!res.ok) throw new Error(parsedResult.error || 'server_error');

      setResult(parsedResult);
      
      const initialExcluded: Record<number, boolean> = {};
      (parsedResult.repairs || []).forEach((r: any, idx: number) => {
        if (['minor_adjacent', 'frame_work', 'internal_element', 'minor_optional'].includes(r.type)) {
          initialExcluded[idx] = true;
        }
      });
      setExcludedRepairs(initialExcluded);

    } catch (err: any) {
      setError(err.message === '429' ? t('quota_exceeded') : err.message);
    } finally { setIsAnalyzing(false); }
  };

  const calculateTotal = () => {
    if (!result) return 0;
    let total = (result.repairs || []).reduce((sum: number, repair: any, idx: number) => {
      if (excludedRepairs[idx]) return sum;
      let cost = repair.cost || 0;
      if (aluminumRepairs[idx]) cost *= 2;
      return sum + cost;
    }, 0);
    const polishingPrices = { none: 0, element: 1500, few: 2500, full: 5000 };
    total += polishingPrices[polishingType] || 0;
    manualPositions.forEach(p => total += p.cost);
    return total;
  };

  const calculatePartsTotal = () => {
    if (!result?.parts) return 0;
    return result.parts.reduce((sum: number, partSearch: any, idx: number) => {
      const cat = selectedParts[idx] || 'average';
      const results = partSearch.results || [];
      if (cat === 'average') {
        const prices = results.map((r: any) => viewMode === 'master' ? r.wholesalePrice : r.retailPrice).filter((p: number) => p > 0);
        return sum + (prices.length ? Math.round(prices.reduce((a: any, b: any) => a + b, 0) / prices.length) : 0);
      }
      const p = results.find((r: any) => r.category === cat);
      return sum + (p ? (viewMode === 'master' ? p.wholesalePrice : p.retailPrice) : 0);
    }, 0);
  };

  const showAluminumOption = shouldShowAluminum(result?.carModel, vinData?.make);

  return (
    <div className="min-h-screen p-4 md:p-8 font-sans selection:bg-rose-500/30">
      <div className="max-w-6xl mx-auto space-y-12">
        
        {/* --- HEADER --- */}
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
          <div className="flex flex-wrap items-center gap-4">
            {/* Lang Switcher */}
            <div className="flex bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-1 shadow-sm font-mono">
              {['ru', 'cs', 'en'].map((lng) => (
                <button
                  key={lng}
                  onClick={() => i18n.changeLanguage(lng)}
                  className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-lg transition-all ${i18n.language === lng ? 'bg-rose-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  {lng}
                </button>
              ))}
            </div>
            <ThemeToggle />
            <div className="flex items-center gap-3 text-[10px] font-mono text-rose-500 uppercase tracking-[0.2em] border border-rose-500/20 bg-rose-500/5 px-4 py-2 rounded">
              <div className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              {t('system_online')}
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-[1fr_450px] gap-8">
          <div className="space-y-6">
            
            {/* --- VIN SEARCH --- */}
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
              {vinData && vinData.found && (
                <div className="mt-6 p-5 bg-white/50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800 rounded-lg flex items-center gap-4 animate-in fade-in zoom-in-95 duration-300">
                  <div className="w-10 h-10 rounded bg-rose-500/10 flex items-center justify-center border border-rose-500/20">
                    <CheckCircle2 className="text-rose-500" size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">{vinData.make} {vinData.model} ({vinData.year})</p>
                    <p className="text-[10px] text-zinc-500 font-mono mt-1 tracking-wider uppercase">{vinData.vin}</p>
                  </div>
                </div>
              )}
            </div>

            {/* --- UPLOAD --- */}
            <div className="glass-panel p-8 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-rose-500/20" />
              <h2 className="text-[10px] font-mono uppercase tracking-[0.3em] mb-6 flex items-center gap-3 text-zinc-500">
                <Camera size={14} className="text-rose-500" />
                {t('media_damage')}
              </h2>
              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`technical-border rounded-lg p-12 text-center cursor-pointer transition-all duration-300 relative group overflow-hidden ${
                  isDragging ? 'border-rose-500 bg-rose-500/5' : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-600 dark:hover:border-zinc-600 hover:bg-zinc-900/30'
                }`}
              >
                {isAnalyzing && <div className="scan-line" />}
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => e.target.files && processFiles(Array.from(e.target.files))} />
                <Upload className="mx-auto mb-4 text-zinc-500" size={24} strokeWidth={1.5} />
                <p className="text-[11px] font-mono text-zinc-300 mb-2 uppercase tracking-[0.2em]">{t('drag_files')}</p>
                <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-widest">{t('or_click')}</p>
              </div>
              
              <div className="grid grid-cols-5 gap-3 mt-8">
                {previews.map((p, idx) => (
                  <div key={idx} className="relative aspect-square border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden group">
                    <img src={p} className="object-cover w-full h-full opacity-60 group-hover:opacity-100 transition-opacity" />
                    <button onClick={(e) => { e.stopPropagation(); setFiles(f => f.filter((_, i) => i !== idx)); setPreviews(pr => pr.filter((_, i) => i !== idx)); }} className="absolute top-1.5 right-1.5 bg-black/80 p-1.5 rounded-lg text-rose-500 hover:bg-rose-600 hover:text-white transition-all"><X size={12}/></button>
                  </div>
                ))}
              </div>
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
              className="w-full py-5 rounded-lg font-bold text-xs uppercase tracking-[0.3em] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed bg-zinc-100 hover:bg-white text-zinc-950 accent-glow shadow-xl"
            >
              {isAnalyzing ? (
                <><Loader2 className="animate-spin" size={18} /> {t('analyzing')}</>
              ) : (
                <><CheckCircle2 size={18} /> {t('analyze')}</>
              )}
            </button>
          </div>

          {/* --- RESULTS --- */}
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
                      {(result.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>

                {/* Repairs Items */}
                <div className="space-y-3 mb-10">
                  {(result.repairs || []).map((repair: any, idx: number) => {
                    const isExcluded = excludedRepairs[idx] || false;
                    const isAluminum = aluminumRepairs[idx] || false;
                    const isActive = !isExcluded;
                    let itemCost = repair.cost || 0;
                    if (isAluminum) itemCost *= 2;

                    return (
                      <div key={idx} className={`p-5 rounded-lg border transition-all relative overflow-hidden ${
                        isActive 
                          ? 'bg-zinc-900/50 border-zinc-800' 
                          : 'bg-zinc-950/30 border-zinc-900 opacity-40'
                      }`}>
                        {isActive && <div className="absolute top-0 left-0 w-1 h-full bg-rose-500/40" />}
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex items-start gap-3">
                            <input 
                              type="checkbox" 
                              checked={isActive} 
                              onChange={() => setExcludedRepairs(prev => ({...prev, [idx]: !prev[idx]}))}
                              className="w-4 h-4 mt-1 accent-rose-600"
                            />
                            <div>
                              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-100">{repair.name}</h4>
                              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-tight mt-1">{repair.description}</p>
                              {isActive && showAluminumOption && (
                                <label className="flex items-center gap-2 mt-3 text-[9px] text-zinc-400 font-bold cursor-pointer hover:text-rose-500 transition-colors">
                                  <input type="checkbox" checked={!!aluminumRepairs[idx]} onChange={() => setAluminumRepairs(p => ({...p, [idx]: !p[idx]}))} className="w-3 h-3 accent-rose-600" /> ALUMINUM (x2)
                                </label>
                              )}
                            </div>
                          </div>
                          <div className="font-mono text-sm font-bold text-rose-500">
                            {itemCost.toLocaleString()} <span className="text-[10px] opacity-50">Kč</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Flags */}
                {(result.grey_flags || []).length > 0 && (
                  <div className="mb-10 space-y-2">
                    {result.grey_flags.map((f: string, i: number) => (
                      <div key={i} className="flex gap-2 text-[9px] text-yellow-600 dark:text-yellow-500 bg-yellow-500/5 p-3 rounded-lg border border-yellow-500/20 font-mono italic">
                        <AlertTriangle size={12} className="shrink-0"/> {f}
                      </div>
                    ))}
                  </div>
                )}

                {/* Parts */}
                {(result.parts || []).length > 0 && (
                  <div className="mb-10 space-y-4">
                    <h3 className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.3em] flex items-center gap-3 mb-6">
                      <Package size={14} className="text-rose-500" />
                      {t('parts_estimate')}
                    </h3>
                    {(result.parts || []).map((partSearch: any, idx: number) => {
                      const isSelected = (selectedParts[idx] || 'average') === 'average';
                      const prices = partSearch.results?.map((r: any) => viewMode === 'master' ? r.wholesalePrice : r.retailPrice).filter((p: number) => p > 0) || [];
                      const avg = prices.length > 0 ? Math.round(prices.reduce((a: any, b: any) => a + b, 0) / prices.length) : 0;

                      return (
                        <div key={idx} className="p-5 rounded-lg bg-white/50 dark:bg-zinc-950/50 border border-zinc-200 dark:border-zinc-800">
                          <h4 className="text-[11px] font-bold text-zinc-100 mb-4 uppercase tracking-wider">{partSearch.partName}</h4>
                          <div className="space-y-2.5">
                            <div 
                              className={`flex justify-between items-center group p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-rose-500/10 border border-rose-500/20' : 'hover:bg-zinc-800/30 border border-transparent'}`}
                              onClick={() => setSelectedParts(prev => ({ ...prev, [idx]: 'average' }))}
                            >
                              <span className={`text-[10px] font-mono uppercase tracking-tighter ${isSelected ? 'text-rose-400' : 'text-zinc-500'}`}>Средняя цена</span>
                              <span className={`text-[11px] font-mono font-bold ${isSelected ? 'text-rose-400' : 'text-zinc-300'}`}>{avg.toLocaleString()} Kč</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Totals Section */}
                <div className="pt-8 border-t border-zinc-200 dark:border-zinc-800 pt-6 space-y-4">
                  <div className="flex justify-between items-center text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                    <span>{t('labor')}</span>
                    <span className="font-bold text-zinc-200">{calculateTotal().toLocaleString()} Kč</span>
                  </div>
                  {(result.parts || []).length > 0 && (
                    <div className="flex justify-between text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                      <span>{t('parts')}</span>
                      <span className="font-bold text-zinc-200">{calculatePartsTotal().toLocaleString()} Kč</span>
                    </div>
                  )}
                  <div className="flex justify-between items-end pt-6 border-t-2 border-rose-600">
                    <span className="text-rose-600 font-black text-xs uppercase tracking-widest">{t('total')}</span>
                    <span className="text-4xl font-black font-mono">{(calculateTotal() + calculatePartsTotal()).toLocaleString()} <span className="text-sm text-zinc-400">Kč</span></span>
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
