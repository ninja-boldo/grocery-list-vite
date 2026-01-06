import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';

type ScanMode = 'auto' | 'manual';

export default function ImprovedScanner() {
  const navHook = useNavigate();
  const location = useLocation();

  // Parse URL parameters
  const queryParams = new URLSearchParams(location.search);
  const subgroups = queryParams.get('subgroups') || '';
  const count = queryParams.get('count') || '1';
  const isWishList = queryParams.get('wishlist') === 'true';

  // State management
  const [mode, setMode] = useState<ScanMode>('auto');
  const [ean, setEan] = useState('');
  const [manualEan, setManualEan] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualQuantity, setManualQuantity] = useState(1);
  const [scanQuantity, setScanQuantity] = useState(1);
  const [inputMode, setInputMode] = useState<'ean' | 'name'>('name');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string>('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [verbose, setVerbose] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [lastScanTime, setLastScanTime] = useState<string>('');
  const [scannedCode, setScannedCode] = useState<string>('');

  const lastSentRef = useRef<{ ean?: string; ts?: number }>({});
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const scannerIdRef = useRef('qr-reader');
  const quantityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scanSubmitTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Logging helper
  const log = useCallback((message: string, data?: unknown) => {
    if (verbose) {
      console.log(`[Scanner] ${message}`, data || '');
    }
  }, [verbose]);

  // Send EAN to server
  const sendEan = useCallback(async (eanToSend: string, quantityToSend?: number) => {
    const now = Date.now();
    if (lastSentRef.current.ean === eanToSend && (now - (lastSentRef.current.ts || 0)) < 2000) {
      log('Skipping duplicate send for', eanToSend);
      return;
    }
    lastSentRef.current = { ean: eanToSend, ts: now };

    const finalCount = quantityToSend || count;
    const url = `/api/add_ean_to_list/`;
    try {
      log('Sending EAN to server', { ean: eanToSend, count: finalCount, url });
      

      fetch(url, {
          method: "POST",
          body: JSON.stringify({
            ean: eanToSend,
            count: count,
            subgroups: subgroups,
            wish_list: isWishList ? "true" : "false"
          }),
          headers: {
            "Content-type": "application/json; charset=UTF-8"
          }
        }).catch(err => {
          console.error('Error sending EAN:', err);
        });

      setShowSuccess(true);
      
      // Haptic feedback
      if ('vibrate' in navigator) {
        try { navigator.vibrate(200); } catch { /* ignore */ }
      }

      setTimeout(() => {
        navHook('/');
      }, 1200);
    } catch (err) {
      console.error('Error sending EAN:', err);
      setError('Failed to add item');
    }
  }, [subgroups, count, isWishList, log, navHook]);

  // Send item by name to server
  const sendByName = useCallback(async (itemName: string, quantityToSend: number) => {
    const url = `/api/add_ean_to_list/`;

    try {
      log('Sending item by name to server', { itemName, count: quantityToSend, url });
      await fetch(url, {
        method: "POST",
        body: JSON.stringify({
          item_name: itemName,
          count: quantityToSend,
          subgroups: subgroups,
          wish_list: isWishList ? "true" : "false"
        }),
        headers: {
          "Content-type": "application/json; charset=UTF-8"
        }
      });
      setShowSuccess(true);
      
      // Haptic feedback
      if ('vibrate' in navigator) {
        try { navigator.vibrate(200); } catch { /* ignore */ }
      }

      setTimeout(() => {
        navHook('/');
      }, 1200);
    } catch (err) {
      console.error('Error sending item:', err);
      setError('Failed to add item');
    }
  }, [subgroups, isWishList, log, navHook]);

  // Handle quantity change with auto-submit timer
  const handleQuantityChange = (delta: number, isScanner = false) => {
    if (isScanner) {
      const newQuantity = Math.max(1, scanQuantity + delta);
      setScanQuantity(newQuantity);
      
      // Clear existing timeout
      if (scanSubmitTimeoutRef.current) {
        clearTimeout(scanSubmitTimeoutRef.current);
      }
      
      // Set new timeout for auto-submit if we have a scanned code
      if (scannedCode) {
        scanSubmitTimeoutRef.current = setTimeout(() => {
          log('Auto-submitting scanned code after 2s delay');
          sendEan(scannedCode, newQuantity);
        }, 2000);
      }
    } else {
      const newQuantity = Math.max(1, manualQuantity + delta);
      setManualQuantity(newQuantity);
      
      // Clear existing timeout
      if (quantityTimeoutRef.current) {
        clearTimeout(quantityTimeoutRef.current);
      }
      
      // Set new timeout for auto-submit (only if we have input)
      if ((inputMode === 'ean' && manualEan) || (inputMode === 'name' && manualName)) {
        quantityTimeoutRef.current = setTimeout(() => {
          log('Auto-submitting after 2s delay');
          handleManualSubmit(new Event('submit') as unknown as React.FormEvent);
        }, 2000);
      }
    }
  };

  // Handle manual submission
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Clear any pending timeout
    if (quantityTimeoutRef.current) {
      clearTimeout(quantityTimeoutRef.current);
    }
    
    if (inputMode === 'ean') {
      if (manualEan && /^\d{8,14}$/.test(manualEan)) {
        log('Manual EAN submit', { ean: manualEan, quantity: manualQuantity });
        sendEan(manualEan, manualQuantity);
      } else {
        setError('Please enter a valid barcode (8-14 digits)');
        setTimeout(() => setError(''), 3000);
      }
    } else {
      if (manualName.trim()) {
        log('Manual name submit', { name: manualName, quantity: manualQuantity });
        sendByName(manualName.trim(), manualQuantity);
      } else {
        setError('Please enter an item name');
        setTimeout(() => setError(''), 3000);
      }
    }
  };

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (quantityTimeoutRef.current) {
        clearTimeout(quantityTimeoutRef.current);
      }
      if (scanSubmitTimeoutRef.current) {
        clearTimeout(scanSubmitTimeoutRef.current);
      }
    };
  }, []);

  // Initialize HTML5 QR Code scanner (only in auto mode)
  useEffect(() => {
    if (mode !== 'auto') return;

    const startScanner = async () => {
      try {
        log('Initializing HTML5 QR Code scanner');
        const html5QrCode = new Html5Qrcode(scannerIdRef.current);
        html5QrCodeRef.current = html5QrCode;

        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        };

        const onScanSuccess = (decodedText: string) => {
          setScanCount(prev => prev + 1);
          setLastScanTime(new Date().toLocaleTimeString());
          log('Scan success', decodedText);

          if (/^\d{8,14}$/.test(decodedText)) {
            setEan(decodedText);
            setScannedCode(decodedText);
            setScanning(false);
            
            // Stop scanner after successful scan
            html5QrCode.stop().catch((err: unknown) => log('Error stopping scanner', err));
            
            // Start auto-submit timer
            scanSubmitTimeoutRef.current = setTimeout(() => {
              log('Auto-submitting scanned code after 2s');
              sendEan(decodedText, scanQuantity);
            }, 2000);
          } else {
            log('Invalid barcode format', decodedText);
          }
        };

        const onScanError = (errorMessage: string) => {
          // Only log if verbose to avoid console spam
          if (verbose) {
            log('Scan error (normal during scanning)', errorMessage);
          }
        };

        // Try to use rear camera
        try {
          await html5QrCode.start(
            { facingMode: 'environment' },
            config,
            onScanSuccess,
            onScanError
          );
          setScanning(true);
          setError('');
          log('Scanner started with rear camera');
        } catch (err) {
          log('Rear camera failed, trying any camera', err);
          // Fallback to any available camera
          try {
            const devices = await Html5Qrcode.getCameras();
            if (devices && devices.length > 0) {
              await html5QrCode.start(
                devices[0].id,
                config,
                onScanSuccess,
                onScanError
              );
              setScanning(true);
              setError('');
              log('Scanner started with fallback camera');
            } else {
              throw new Error('No cameras found');
            }
          } catch (fallbackErr) {
            console.error('Camera initialization failed:', fallbackErr);
            setError('Camera access failed. Try manual mode.');
          }
        }
      } catch (err) {
        console.error('Scanner initialization error:', err);
        setError('Scanner initialization failed. Try manual mode.');
      }
    };

    startScanner();

    return () => {
      log('Cleaning up HTML5 QR Code scanner');
      if (html5QrCodeRef.current?.isScanning) {
        html5QrCodeRef.current.stop().catch(err => 
          console.error('Error stopping scanner:', err)
        );
      }
    };
  }, [mode, sendEan, log, verbose, scanQuantity]);

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden flex flex-col">
      {/* Compact Header */}
      <div className="bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/50">
        <div className="max-w-4xl mx-auto px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            {/* Left: Close + Title */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => navHook('/')}
                className="p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/80 border border-slate-600/40 transition-all"
              >
                <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <h1 className="text-sm sm:text-base font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
                {isWishList ? 'Wish List' : 'Add Item'}
              </h1>
            </div>
            
            {/* Center: Mode Toggle */}
            <div className="flex gap-1 bg-slate-800/60 p-0.5 rounded-lg border border-slate-600/40">
              <button
                onClick={() => setMode('auto')}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all ${
                  mode === 'auto'
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-lg shadow-cyan-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Auto
              </button>
              <button
                onClick={() => setMode('manual')}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition-all ${
                  mode === 'manual'
                    ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-lg shadow-emerald-500/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Manual
              </button>
            </div>

            {/* Right: Verbose Toggle */}
            <button
              onClick={() => setVerbose(!verbose)}
              className={`p-1.5 rounded-lg border transition-all ${
                verbose
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                  : 'bg-slate-800/60 border-slate-600/40 text-slate-400 hover:text-white'
              }`}
              title="Toggle verbose logging"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content - Scrollable */}
      <div className="flex-1 overflow-auto">
        {mode === 'auto' ? (
          /* Auto Scanner Mode */
          <div className="flex flex-col items-center justify-start p-4 min-h-full">
            {/* Scanner Container */}
            <div className="w-full max-w-sm space-y-4">
              <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-600/40 p-4 shadow-2xl shadow-cyan-500/10">
                {/* Scanner Area */}
                <div id={scannerIdRef.current} className="rounded-xl overflow-hidden border-2 border-cyan-400/60 shadow-lg shadow-cyan-400/20 bg-black" style={{ minHeight: '280px' }} />
                
                {/* Status */}
                <div className="mt-3 text-center">
                  <p className="text-sm font-medium">
                    {showSuccess ? (
                      <span className="flex items-center justify-center gap-2 text-emerald-400 animate-pulse">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Added successfully!
                      </span>
                    ) : error ? (
                      <span className="text-rose-400">{error}</span>
                    ) : ean ? (
                      <span className="text-cyan-400 font-mono">Code: {ean}</span>
                    ) : scanning ? (
                      <span className="text-slate-300 flex items-center justify-center gap-2">
                        <span className="animate-pulse">●</span> Scanning...
                      </span>
                    ) : (
                      <span className="text-slate-400">Point at barcode</span>
                    )}
                  </p>
                </div>

                {/* Verbose Debug Info */}
                {verbose && (
                  <div className="mt-3 p-2 bg-slate-900/60 rounded-lg border border-amber-500/30">
                    <p className="text-xs text-amber-400 font-mono">
                      Scans: {scanCount} | Last: {lastScanTime || 'N/A'}
                    </p>
                    <p className="text-xs text-amber-400 font-mono">
                      Status: {scanning ? 'Active' : 'Stopped'}
                    </p>
                  </div>
                )}
              </div>

              {/* Quantity Selector for Scanned Items */}
              {scannedCode && (
                <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl rounded-2xl border border-emerald-500/40 p-4 shadow-2xl shadow-emerald-500/20 animate-slideIn">
                  <label className="block text-xs text-emerald-400 mb-3 text-center font-semibold">Adjust Quantity</label>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(-1, true)}
                      className="w-14 h-14 flex items-center justify-center bg-slate-700/60 hover:bg-slate-600/80 border border-slate-600/40 rounded-xl transition-all active:scale-90 transform duration-150 shadow-lg hover:shadow-slate-500/50"
                    >
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M20 12H4" />
                      </svg>
                    </button>
                    
                    <div className="flex-1 max-w-[140px]">
                      <div className="relative">
                        <input
                          type="number"
                          value={scanQuantity}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 1;
                            setScanQuantity(Math.max(1, val));
                          }}
                          min="1"
                          className="w-full px-4 py-4 bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-emerald-500/50 rounded-xl text-white text-3xl font-bold text-center focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-all shadow-inner transform hover:scale-105 duration-200"
                        />
                      </div>
                    </div>
                    
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(1, true)}
                      className="w-14 h-14 flex items-center justify-center bg-emerald-500/30 hover:bg-emerald-500/50 border-2 border-emerald-500/60 rounded-xl transition-all active:scale-90 transform duration-150 shadow-lg hover:shadow-emerald-500/50"
                    >
                      <svg className="w-6 h-6 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-emerald-400/80 text-center font-medium">
                    Auto-submits in 2s or tap to adjust
                  </p>
                  
                  {/* Manual Submit Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (scanSubmitTimeoutRef.current) {
                        clearTimeout(scanSubmitTimeoutRef.current);
                      }
                      sendEan(scannedCode, scanQuantity);
                    }}
                    className="w-full mt-3 py-2.5 text-sm bg-gradient-to-r from-emerald-500 to-green-500 text-white font-bold rounded-lg shadow-lg shadow-emerald-500/30 hover:from-emerald-400 hover:to-green-400 transition-all active:scale-95"
                  >
                    Submit Now
                  </button>
                </div>
              )}

              {/* Tips */}
              <div className="p-3 bg-slate-900/40 rounded-xl border border-slate-700/30">
                <p className="text-xs text-slate-400 text-center">
                  💡 Position barcode in the center of the frame
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Manual Entry Mode */
          <div className="flex items-start justify-center p-4 min-h-full">
            <div className="w-full max-w-md">
              <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 backdrop-blur-xl rounded-2xl border border-slate-600/40 p-6 shadow-2xl">
                <div className="text-center mb-4">
                  <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-emerald-500 to-green-500 rounded-xl mb-3 shadow-lg shadow-emerald-500/40 animate-pulse">
                    <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">Add Item</h2>
                  
                  {/* Input Mode Toggle */}
                  <div className="flex gap-2 justify-center">
                    <button
                      type="button"
                      onClick={() => setInputMode('name')}
                      className={`px-4 py-2 text-sm rounded-lg font-medium transition-all duration-200 ${
                        inputMode === 'name'
                          ? 'bg-emerald-500/30 text-emerald-300 border-2 border-emerald-500/60 shadow-lg shadow-emerald-500/30'
                          : 'text-slate-400 border border-slate-600/40 hover:text-white hover:border-slate-500'
                      }`}
                    >
                      By Name
                    </button>
                    <button
                      type="button"
                      onClick={() => setInputMode('ean')}
                      className={`px-4 py-2 text-sm rounded-lg font-medium transition-all duration-200 ${
                        inputMode === 'ean'
                          ? 'bg-emerald-500/30 text-emerald-300 border-2 border-emerald-500/60 shadow-lg shadow-emerald-500/30'
                          : 'text-slate-400 border border-slate-600/40 hover:text-white hover:border-slate-500'
                      }`}
                    >
                      By Barcode
                    </button>
                  </div>
                </div>

                <form onSubmit={handleManualSubmit} className="space-y-5">
                  {/* Input Field */}
                  {inputMode === 'name' ? (
                    <div>
                      <label className="block text-sm text-slate-300 mb-2 font-medium">Item Name</label>
                      <input
                        type="text"
                        value={manualName}
                        onChange={(e) => setManualName(e.target.value)}
                        placeholder="e.g., Milk, Bread, Apples..."
                        className="w-full px-4 py-3 bg-slate-900/60 border border-slate-600/40 rounded-xl text-white text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all shadow-inner"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm text-slate-300 mb-2 font-medium">Barcode (EAN)</label>
                      <input
                        type="text"
                        value={manualEan}
                        onChange={(e) => setManualEan(e.target.value.replace(/\D/g, ''))}
                        placeholder="e.g., 4006040055136"
                        className="w-full px-4 py-3 bg-slate-900/60 border border-slate-600/40 rounded-xl text-white text-base font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all shadow-inner"
                        maxLength={14}
                        autoFocus
                      />
                      <p className="mt-1.5 text-xs text-slate-400 text-center">
                        {manualEan.length} / 14 digits
                      </p>
                    </div>
                  )}

                  {/* Quantity Selector (Dial-like with animations) */}
                  <div>
                    <label className="block text-sm text-slate-300 mb-3 font-medium">Quantity</label>
                    <div className="flex items-center justify-center gap-4">
                      <button
                        type="button"
                        onClick={() => handleQuantityChange(-1)}
                        className="w-14 h-14 flex items-center justify-center bg-slate-700/60 hover:bg-slate-600/80 border border-slate-600/40 rounded-xl transition-all active:scale-90 transform duration-150 shadow-lg hover:shadow-slate-500/50"
                      >
                        <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M20 12H4" />
                        </svg>
                      </button>
                      
                      <div className="flex-1 max-w-[140px]">
                        <div className="relative">
                          <input
                            type="number"
                            value={manualQuantity}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 1;
                              setManualQuantity(Math.max(1, val));
                            }}
                            min="1"
                            className="w-full px-4 py-4 bg-gradient-to-br from-slate-900 to-slate-800 border-2 border-emerald-500/50 rounded-xl text-white text-3xl font-bold text-center focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-all shadow-inner transform hover:scale-105 duration-200"
                          />
                        </div>
                      </div>
                      
                      <button
                        type="button"
                        onClick={() => handleQuantityChange(1)}
                        className="w-14 h-14 flex items-center justify-center bg-emerald-500/30 hover:bg-emerald-500/50 border-2 border-emerald-500/60 rounded-xl transition-all active:scale-90 transform duration-150 shadow-lg hover:shadow-emerald-500/50"
                      >
                        <svg className="w-6 h-6 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-400 text-center">
                      ⏱ Auto-submits after 2s
                    </p>
                  </div>

                  {error && (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 animate-shake">
                      <p className="text-rose-400 text-sm text-center">{error}</p>
                    </div>
                  )}

                  {showSuccess && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 animate-slideIn">
                      <p className="text-emerald-400 text-sm text-center flex items-center justify-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Added successfully!
                      </p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={
                      (inputMode === 'ean' && (!manualEan || manualEan.length < 8)) ||
                      (inputMode === 'name' && !manualName.trim()) ||
                      showSuccess
                    }
                    className="w-full py-4 text-base bg-gradient-to-r from-emerald-500 to-green-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/40 hover:from-emerald-400 hover:to-green-400 disabled:from-slate-600 disabled:to-slate-600 disabled:shadow-none transition-all disabled:cursor-not-allowed active:scale-95 transform duration-150"
                  >
                    Add to {isWishList ? 'Wish List' : 'Grocery List'}
                  </button>
                </form>

                {/* Verbose Debug Info */}
                {verbose && (
                  <div className="mt-4 p-3 bg-slate-900/60 rounded-lg border border-amber-500/30">
                    <p className="text-xs text-amber-400 font-mono">
                      Mode: {inputMode} | Quantity: {manualQuantity}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }

        .animate-slideIn {
          animation: slideIn 0.3s ease-out;
        }

        .animate-shake {
          animation: shake 0.3s ease-in-out;
        }
      `}</style>
    </div>
  );
}
