import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import ShortPopup from '../utils/ShortPopUp';
import TopBar from '@/comp/other/TopBar';
import Sidebar from '@/comp/other/Sidebar';
import { PageModes } from '@/lib/utils';

// ── Palette (mirrors main site) ─────────────────────────────────────────────
const P = {
  bg: '#0d1117',
  surface: '#161b22',
  border: '#21262d',
  teal: '#0d9488',
  tealD: '#0f2a28',
  tealB: '#0d948850',
  text: '#e6edf3',
  muted: '#6e7681',
  subtle: '#4d5566',
} as const;


//TODO: implement jwt webtockens to e.g. savely let there be multiple users
// + implement classification or general shortening of the names of the items
// e.g. gut und guenstig joghurt becomes joghurt (perhaps just use langchain + ollama as background job)
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
  const [headline, setHeadline] = useState('');
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const scanLockRef = useRef(false);
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



  const hardStopCamera = async () => {
  const qr = html5QrCodeRef.current;
  if (!qr) return;

  try {
    if (qr.isScanning) {
      await qr.stop();
    }

    // HARD KILL MEDIA STREAMS 
    const videoElem = document.querySelector('video');
    const stream = videoElem?.srcObject as MediaStream | null;

    stream?.getTracks().forEach(track => {
      track.stop();
    });

    if (videoElem) {
      videoElem.srcObject = null;
    }

  } catch (e) {
    console.warn('Hard stop failed:', e);
  } finally {
    html5QrCodeRef.current = null;
  }
};



  // Send EAN to server
const sendEan = useCallback(async (eanToSend: string, quantityToSend?: number) => {
  const now = Date.now();
  
  // Debounce/Duplicate logic
  if (lastSentRef.current.ean === eanToSend && (now - (lastSentRef.current.ts || 0)) < 1000) {
    log('Skipping duplicate send for', eanToSend);
    return;
  }
  lastSentRef.current = { ean: eanToSend, ts: now };

  const finalCount = quantityToSend || count;
  const url = "/api/add_ean_to_list/"; 
  try {
    
    const resp = await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        ean: eanToSend,
        count: finalCount,
        subgroups: subgroups,
        wish_list: String(isWishList)
      }),
      headers: {
        "Content-type": "application/json; charset=UTF-8"
      }
    });

    if (resp.ok) {
      
      const data = await resp.json()

      if (data.known_to_db && data.known_to_db === true && !( String(data.detail).toLowerCase() === "failed to add item")) {
        console.log('Item recognized by database');
        setShowSuccess(true)
        setTimeout(() => {
          setShowSuccess(false)
        }, 2500);
      }
      else{
        setError("ean not found")
        setTimeout(() => {
          setError("")
        }, 2500);
      }
    } else {
      setError("ean not found")
      console.error('Server returned an error status:', resp.status);
      setTimeout(() => {
          setError("")
        }, 2500);
    }
  } catch (err) {
    setError("network error")
    console.error('Network error or parsing error:', err);
    setTimeout(() => {
          setError("")
        }, 2500);
  }
}, [subgroups, count, isWishList, log]);

  // Send item by name to server
  const sendByName = useCallback(async (itemName: string, quantityToSend: number) => {

    try {
      const url = "/api/add_ean_to_list/"
      console.log('Sending item by name to server', { itemName, count: quantityToSend, url });
      await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        item_name: itemName,
        count: quantityToSend,
        subgroups: subgroups,
        wish_list: String(isWishList)
      }),
      headers: {
        "Content-type": "application/json; charset=UTF-8"
      }
    }).catch(err => {
      console.error('Error sending EAN:', err);
    });
      
      
      // Haptic feedback
      if ('vibrate' in navigator) {
        try { navigator.vibrate(200); } catch { /* ignore */ }
      }

      
    } catch (err) {
      console.error('Error sending item:', err);
      setError('Failed to add item');
    }
  }, [subgroups, isWishList]);

  // Handle quantity change with auto-submit timer
  const handleQuantityChange = (delta: number, isScanner = false) => {
    if (isScanner) {
      const newQuantity = Math.max(1, scanQuantity + delta);
      setScanQuantity(newQuantity);
      
    } else {
      const newQuantity = Math.max(1, manualQuantity + delta);
      setManualQuantity(newQuantity);
      
      // Clear existing timeout
      if (quantityTimeoutRef.current) {
        clearTimeout(quantityTimeoutRef.current);
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
        setTimeout(() => setError(''), 2500);
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
    const deleteFrom = isWishList ? "wish" : "item"
    const newHeadline = count === '1' ? `add ${deleteFrom}` : `delete ${deleteFrom}`;
    setHeadline(newHeadline);
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
          // This lives outside onScanSuccess

            if (scanLockRef.current) return; // ignore if we're in cooldown

            scanLockRef.current = true;  // lock scanning

            console.log('Processing', decodedText);


          if (/^\d{8,14}$/.test(decodedText)) {
            setEan(decodedText);
            setScannedCode(decodedText);
            setScanning(false);
            
            setTimeout(() => {
              scanLockRef.current = false;
            }, 1000);

            //sendEan(decodedText, scanQuantity)
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

  // ── Shared style helpers ───────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    display: 'block', width: '100%', boxSizing: 'border-box',
    padding: '9px 12px', backgroundColor: P.bg,
    border: `1px solid ${P.border}`, borderRadius: 10,
    color: P.text, fontSize: 14, outline: 'none', transition: 'border-color 0.15s',
  };

  const qtyBtnStyle = (isPlus: boolean): React.CSSProperties => ({
    all: 'unset' as const, boxSizing: 'border-box' as const,
    width: 44, height: 44,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, fontSize: 22, fontWeight: 300, cursor: 'pointer',
    backgroundColor: isPlus ? P.tealD : P.surface,
    border: `1px solid ${isPlus ? P.tealB : P.border}`,
    color: isPlus ? '#5eead4' : P.muted,
    transition: 'all 0.15s', flexShrink: 0,
  });

  const submitBtnStyle: React.CSSProperties = {
    all: 'unset' as const, boxSizing: 'border-box' as const,
    display: 'block', width: '100%', textAlign: 'center' as const,
    marginTop: 12, padding: '10px 0',
    backgroundColor: P.tealD, border: `1px solid ${P.tealB}`,
    borderRadius: 10, color: '#5eead4', fontSize: 14, fontWeight: 500,
    cursor: 'pointer', transition: 'all 0.15s',
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: P.bg }}>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <TopBar
        sidebarOpen={sidebarOpen}
        onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
        subgroups={[]}
        onFilter={null}
        onReset={() => null}
        onScanIncrease={() => null}
        onScanDecrease={() => null}
        items={[]}
        setItems={() => null}
        mode={PageModes.GeoPage}
      />

      <div className="p-3 sm:p-4 md:p-6">
        <div className="max-w-lg mx-auto">

          {/* Title row: back + headline + mode toggle + verbose */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            {/* Back */}
            <button
              onClick={async () => { await hardStopCamera(); navHook('/'); }}
              style={{
                all: 'unset', boxSizing: 'border-box',
                width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: P.surface, border: `1px solid ${P.border}`,
                borderRadius: 9, color: P.muted, cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
                fontSize: 16,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = P.text; (e.currentTarget as HTMLElement).style.borderColor = P.tealB; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = P.muted; (e.currentTarget as HTMLElement).style.borderColor = P.border; }}
              aria-label="Back"
            >
              ‹
            </button>

            {/* Headline */}
            <span style={{ flex: 1, color: P.text, fontSize: 14, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {headline}
            </span>

            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: 2, backgroundColor: P.surface, padding: 3, borderRadius: 10, border: `1px solid ${P.border}`, flexShrink: 0 }}>
              {(['auto', 'manual'] as ScanMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    all: 'unset', boxSizing: 'border-box',
                    padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', transition: 'all 0.15s',
                    backgroundColor: mode === m ? P.tealD : 'transparent',
                    border: `1px solid ${mode === m ? P.tealB : 'transparent'}`,
                    color: mode === m ? '#5eead4' : P.muted,
                  }}
                >
                  {m === 'auto' ? 'Auto' : 'Manual'}
                </button>
              ))}
            </div>

            {/* Verbose toggle */}
            <button
              onClick={() => setVerbose(!verbose)}
              style={{
                all: 'unset', boxSizing: 'border-box',
                width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: verbose ? P.tealD : P.surface,
                border: `1px solid ${verbose ? P.tealB : P.border}`,
                borderRadius: 9, color: verbose ? '#5eead4' : P.muted,
                cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
              }}
              title="Toggle verbose logging"
            >
              <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
          </div>

          {mode === 'auto' ? (
            /* ── Auto scanner ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Camera card */}
              <div style={{ backgroundColor: P.surface, border: `1px solid ${P.border}`, borderRadius: 18, padding: 16, boxShadow: '0 8px 32px #00000060' }}>
                <div
                  id={scannerIdRef.current}
                  style={{ borderRadius: 12, overflow: 'hidden', border: `2px solid ${P.tealB}`, backgroundColor: '#000', minHeight: 280 }}
                />
                {/* Status */}
                <div style={{ marginTop: 10, textAlign: 'center' }}>
                  {showSuccess ? (
                    <span style={{ color: '#5eead4', fontSize: 13, fontWeight: 500 }}>✓ Added successfully!</span>
                  ) : error ? (
                    <span style={{ color: '#f87171', fontSize: 13 }}>{error}</span>
                  ) : ean ? (
                    <span style={{ color: '#5eead4', fontSize: 13, fontFamily: 'monospace' }}>Code: {ean}</span>
                  ) : scanning ? (
                    <span style={{ color: P.muted, fontSize: 13 }}>● Scanning...</span>
                  ) : (
                    <span style={{ color: P.subtle, fontSize: 13 }}>Point at barcode</span>
                  )}
                </div>
                {verbose && (
                  <div style={{ marginTop: 10, padding: '7px 10px', backgroundColor: P.bg, borderRadius: 8, border: `1px solid ${P.tealB}` }}>
                    <p style={{ margin: 0, fontSize: 11, color: P.teal, fontFamily: 'monospace' }}>Scans: {scanCount} | Last: {lastScanTime || 'N/A'} | Status: {scanning ? 'Active' : 'Stopped'}</p>
                  </div>
                )}
              </div>

              {/* Scanned code quantity + submit */}
              {scannedCode && (
                <div style={{ backgroundColor: P.surface, border: `1px solid ${P.tealB}`, borderRadius: 18, padding: 16 }}>
                  <p style={{ margin: '0 0 12px', textAlign: 'center', color: '#5eead4', fontSize: 12, fontWeight: 500 }}>Adjust Quantity</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
                    <button type="button" onClick={() => handleQuantityChange(-1, true)} style={qtyBtnStyle(false)}>−</button>
                    <input
                      type="number" value={scanQuantity}
                      onChange={e => setScanQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      min="1"
                      style={{ width: 80, padding: '10px 8px', backgroundColor: P.bg, border: `2px solid ${P.tealB}`, borderRadius: 10, color: P.text, fontSize: 26, fontWeight: 700, textAlign: 'center', outline: 'none' }}
                    />
                    <button type="button" onClick={() => handleQuantityChange(1, true)} style={qtyBtnStyle(true)}>+</button>
                  </div>
                  <button
                    type="button"
                    onClick={() => { if (scanSubmitTimeoutRef.current) clearTimeout(scanSubmitTimeoutRef.current); sendEan(scannedCode, scanQuantity); }}
                    style={submitBtnStyle}
                  >
                    Submit Now
                  </button>
                </div>
              )}

              {error !== '' && <ShortPopup text={error} variant="error" />}
              {showSuccess && <ShortPopup text="mapped ean successfully :)" variant="success" />}

              <p style={{ textAlign: 'center', color: P.subtle, fontSize: 12 }}>Position barcode in the center of the frame</p>
            </div>
          ) : (
            /* ── Manual entry ── */
            <div style={{ backgroundColor: P.surface, border: `1px solid ${P.border}`, borderRadius: 18, padding: '20px 16px', boxShadow: '0 8px 32px #00000060' }}>

              {/* Input mode toggle */}
              <div style={{ display: 'flex', gap: 2, backgroundColor: P.bg, padding: 3, borderRadius: 10, border: `1px solid ${P.border}`, marginBottom: 16 }}>
                {(['name', 'ean'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setInputMode(m)}
                    style={{
                      all: 'unset', boxSizing: 'border-box',
                      flex: 1, padding: '6px 0', textAlign: 'center',
                      borderRadius: 8, fontSize: 12, fontWeight: 500,
                      cursor: 'pointer', transition: 'all 0.15s',
                      backgroundColor: inputMode === m ? P.tealD : 'transparent',
                      border: `1px solid ${inputMode === m ? P.tealB : 'transparent'}`,
                      color: inputMode === m ? '#5eead4' : P.muted,
                    }}
                  >
                    {m === 'name' ? 'By Name' : 'By Barcode'}
                  </button>
                ))}
              </div>

              <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {inputMode === 'name' ? (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: P.muted, marginBottom: 6 }}>Item Name</label>
                    <input
                      type="text" value={manualName}
                      onChange={e => setManualName(e.target.value)}
                      placeholder="e.g. Milk, Bread, Apples..."
                      autoFocus style={inputStyle}
                      onFocus={e => (e.currentTarget.style.borderColor = P.teal)}
                      onBlur={e => (e.currentTarget.style.borderColor = P.border)}
                    />
                  </div>
                ) : (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, color: P.muted, marginBottom: 6 }}>Barcode (EAN)</label>
                    <input
                      type="text" value={manualEan}
                      onChange={e => setManualEan(e.target.value.replace(/\D/g, ''))}
                      placeholder="e.g. 4006040055136"
                      maxLength={14} autoFocus
                      style={{ ...inputStyle, fontFamily: 'monospace' }}
                      onFocus={e => (e.currentTarget.style.borderColor = P.teal)}
                      onBlur={e => (e.currentTarget.style.borderColor = P.border)}
                    />
                    <p style={{ margin: '4px 0 0', fontSize: 11, color: P.subtle, textAlign: 'center' }}>{manualEan.length} / 14 digits</p>
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12, color: P.muted, marginBottom: 8 }}>Quantity</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
                    <button type="button" onClick={() => handleQuantityChange(-1)} style={qtyBtnStyle(false)}>−</button>
                    <input
                      type="number" value={manualQuantity}
                      onChange={e => setManualQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      min="1"
                      style={{ width: 80, padding: '10px 8px', backgroundColor: P.bg, border: `2px solid ${P.tealB}`, borderRadius: 10, color: P.text, fontSize: 26, fontWeight: 700, textAlign: 'center', outline: 'none' }}
                    />
                    <button type="button" onClick={() => handleQuantityChange(1)} style={qtyBtnStyle(true)}>+</button>
                  </div>
                </div>

                {error !== '' && <ShortPopup text={error} variant="error" />}
                {showSuccess && <ShortPopup text="mapped ean successfully :)" variant="success" />}

                <button
                  type="submit"
                  disabled={(inputMode === 'ean' && (!manualEan || manualEan.length < 8)) || (inputMode === 'name' && !manualName.trim()) || showSuccess}
                  style={{
                    ...submitBtnStyle,
                    opacity: ((inputMode === 'ean' && (!manualEan || manualEan.length < 8)) || (inputMode === 'name' && !manualName.trim()) || showSuccess) ? 0.4 : 1,
                    cursor: ((inputMode === 'ean' && (!manualEan || manualEan.length < 8)) || (inputMode === 'name' && !manualName.trim()) || showSuccess) ? 'not-allowed' : 'pointer',
                  }}
                >
                  Add to {isWishList ? 'Wish List' : 'Grocery List'}
                </button>
              </form>

              {verbose && (
                <div style={{ marginTop: 12, padding: '7px 10px', backgroundColor: P.bg, borderRadius: 8, border: `1px solid ${P.tealB}` }}>
                  <p style={{ margin: 0, fontSize: 11, color: P.teal, fontFamily: 'monospace' }}>Mode: {inputMode} | Quantity: {manualQuantity}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

