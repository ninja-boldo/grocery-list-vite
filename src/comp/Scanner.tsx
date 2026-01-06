import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Quagga from '@ericblade/quagga2';

type QuaggaAny = any;
const QuaggaAny: QuaggaAny = Quagga as any;

// simplified Quagga result type used in this file
interface QuaggaResult {
  codeResult?: {
    code?: string;
    format?: string;
  };
}

export default function FullScreenCameraScanner() {
  const navHook = useNavigate();
  const scannerRef = useRef<HTMLDivElement | null>(null);

  const [ean, setEan] = useState('');
  const [scanning, setScanning] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string>('');
  const [, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');

  // dedupe: don't send the same barcode repeatedly within X ms
  const lastSentRef = useRef<{ ean?: string; ts?: number }>({});

  // ensure body fullscreen while scanner is open
  useEffect(() => {
    const prev = {
      margin: document.body.style.margin,
      padding: document.body.style.padding,
      overflow: document.body.style.overflow,
      width: document.body.style.width,
      height: document.body.style.height
    };
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.width = '100vw';
    document.body.style.height = '100vh';

    return () => {
      document.body.style.margin = prev.margin;
      document.body.style.padding = prev.padding;
      document.body.style.overflow = prev.overflow;
      document.body.style.width = prev.width;
      document.body.style.height = prev.height;
    };
  }, []);

  // enumerate cameras and auto-select a rear camera if available
  useEffect(() => {
    const getCameras = async () => {
      try {
        // prompt for permission
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(t => t.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        console.log('Available cameras:', videoDevices);
        setAvailableCameras(videoDevices);

        // heuristics to pick rear camera by label
        if (videoDevices.length > 0) {
          const rear = videoDevices.find(device => {
            const label = (device.label || '').toLowerCase();

            return (
              label.includes('back') ||
              label.includes('rear') ||
              label.includes('hinten') ||
              label.includes('rück') ||
              label.includes('macbook')
            );
          });

          setSelectedCameraId(rear?.deviceId || videoDevices[0].deviceId);
        } else {
          setSelectedCameraId('fallback');
        }
      } catch (err) {
        console.error('Error getting cameras:', err);
        setError('Camera access denied or unavailable');

        // fallback attempt: facingMode environment
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          stream.getTracks().forEach(t => t.stop());
          setSelectedCameraId('fallback');
          setAvailableCameras([{
            deviceId: 'fallback',
            label: 'Rear Camera',
            kind: 'videoinput',
            groupId: '',
            toJSON: () => ({ deviceId: 'fallback', label: 'Rear Camera', kind: 'videoinput', groupId: '' })
          } as MediaDeviceInfo]);
        } catch (fallbackErr) {
          console.error('Fallback camera access failed:', fallbackErr);
          setError('No camera access available');
        }
      } finally {
        setInitializing(false);
      }
    };

    getCameras();
  }, []);

  // preserve previous URL query behavior
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  let subgroups = queryParams.get('subgroups');
  let count = queryParams.get('count');
  const isWishList = queryParams.get('wishlist');
  console.log("this is the is wishlist value: " + isWishList)

  const sendEan = (eanToSend: string) => {
    // keep backward compatible param behavior
    if (!subgroups) subgroups = '';
    if (!count) count = '1';

    // dedupe: if same as last sent within 2000ms, skip sending
    const now = Date.now();
    if (lastSentRef.current.ean === eanToSend && (now - (lastSentRef.current.ts || 0)) < 2000) {
      console.log('Skipping duplicate send for', eanToSend);
      return;
    }
    lastSentRef.current = { ean: eanToSend, ts: now };

    console.log('the parentsList read by use params are like this: ' + subgroups + '\ncount read out: ' + count);
    // keep the original API endpoint and query-style call
    const url = `/api/add_ean_to_list/`;

    fetch(url, {
      method: "POST",
      body: JSON.stringify({
        ean: eanToSend,
        count: count,
        subgroups: subgroups
      }),
      headers: {
        "Content-type": "application/json; charset=UTF-8"
      }
    }).catch(err => {
      console.error('Error sending EAN:', err);
    });
  };

  // initialize and start Quagga
  useEffect(() => {
    if (initializing || !scannerRef.current) return;
    if (!selectedCameraId) return;

    const goHome = () => navHook('/');

    // Build constraints: prefer exact deviceId when available, else facingMode
    const isFallback = selectedCameraId === 'fallback' || selectedCameraId === '';
    const deviceIdConstraint = !isFallback ? { exact: selectedCameraId } : undefined;

    const constraints = isFallback
      ? { facingMode: 'environment', width: { min: 640, max: 1920 }, height: { min: 480, max: 1080 } }
      : { deviceId: deviceIdConstraint, width: { min: 640, max: 1920 }, height: { min: 480, max: 1080 } };

    const config = {
      inputStream: {
        name: 'Live',
        type: 'LiveStream',
        target: scannerRef.current,
        constraints,
        area: { top: '20%', right: '20%', left: '20%', bottom: '20%' }
      },
      locator: { patchSize: 'medium', halfSample: true },
      numOfWorkers: navigator.hardwareConcurrency ? Math.max(1, navigator.hardwareConcurrency - 1) : 2,
      frequency: 10,
      decoder: { readers: ['ean_reader', 'ean_8_reader', 'code_128_reader', 'code_39_reader'] },
      locate: true
    };

    console.log('Initializing Quagga with camera:', selectedCameraId);
    setError('');

    try {
      QuaggaAny.init(config, (err?: Error) => {
        if (err) {
          console.error('Quagga initialization failed:', err);
          setError('Scanner initialization failed');
          return;
        }
        console.log('Quagga initialized successfully');
        QuaggaAny.start();
        setScanning(true);
      });
    } catch (e) {
      console.error('Quagga init threw:', e);
      setError('Scanner initialization threw an error');
      return;
    }

    // Keep the overlay canvas in sync with the displayed video so the green box aligns
    QuaggaAny.onProcessed && QuaggaAny.onProcessed(() => {
      const videoEl = scannerRef.current?.querySelector('video') as HTMLVideoElement | null;
      const overlay = QuaggaAny.canvas?.dom?.overlay as HTMLCanvasElement | undefined;
      if (videoEl && overlay) {
        // set overlay size to match displayed video element size
        overlay.style.width = `${videoEl.offsetWidth}px`;
        overlay.style.height = `${videoEl.offsetHeight}px`;
        overlay.width = videoEl.videoWidth || videoEl.offsetWidth;
        overlay.height = videoEl.videoHeight || videoEl.offsetHeight;
      }
    });

    // detection handler
    const onDetected = (result: QuaggaResult) => {
      const code = result?.codeResult?.code ?? '';
      const format = result?.codeResult?.format ?? '';
      if (!code) return;
      console.log(`Detected ${format}: ${code}`);

      // Validate EAN format (8-14 digits)
      if (/^\d{8,14}$/.test(code)) {
        setEan(code);
        setScanning(false);

        console.log('Valid EAN detected, sending...');
        sendEan(code);

        // haptic feedback if available
        if ('vibrate' in navigator) {
          try { navigator.vibrate(200); } catch { /* ignore */ }
        }

        // stop and go home after a short delay so Quagga doesn't continue scanning the same code
        setTimeout(() => {
          try { QuaggaAny.stop(); } catch {}
          goHome();
        }, 800);
      }
    };

    QuaggaAny.onDetected && QuaggaAny.onDetected(onDetected);

    return () => {
      console.log('Cleaning up Quagga scanner');
      try {
        QuaggaAny.stop();
      } catch (e) { /* ignore */ }
      try {
        QuaggaAny.offDetected && QuaggaAny.offDetected(onDetected);
      } catch (e) { /* ignore */ }

      // defensive: stop any video tracks Quagga may have opened
      const videoEl = scannerRef.current?.querySelector('video') as HTMLVideoElement | null;
      if (videoEl?.srcObject instanceof MediaStream) {
        videoEl.srcObject.getTracks().forEach(t => t.stop());
      }
    };
  }, [navHook, selectedCameraId, initializing]);

  const navigateMlScanner = () => navHook('/scanner/ml');
  const navigateManualAdd = (isWishList: string | null) => {
    if(isWishList){
      navHook(`/scanner/manual?wishlist=${isWishList}`);
    }
    else{
      console.error("the is wish list parameter doesnt seem to be supplied the right way therefore it will fallback to iswishlist = false")
      navHook(`/scanner/manual?wishlist=false`);
    }
  }

  // concrete styles (no placeholder objects)
  const initStyle: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
    backgroundColor: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'white', fontSize: 18
  };

  const errorStyle: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
    backgroundColor: 'black', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 18,
    padding: 20, textAlign: 'center'
  };

  const fullScreenStyle: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'black', overflow: 'hidden'
  };

  const controlsStyle: React.CSSProperties = {
    position: 'fixed', bottom: 20, left: 0, right: 0, textAlign: 'center', color: 'white',
    textShadow: '2px 2px 4px rgba(0,0,0,0.8)', fontSize: 20, fontWeight: 'bold', zIndex: 10000, padding: '0 20px'
  };

  if (initializing) {
    return (
      <div style={initStyle}>
        Initializing camera...
      </div>
    );
  }

  if (error) {
    return (
      <div style={errorStyle}>
        <div style={{ marginBottom: 20 }}>{error}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={navigateMlScanner} style={{ padding: '10px 20px', backgroundColor: '#007AFF', color: 'white', border: 'none', borderRadius: 5 }}>Use ML Scanner</button>
          <button onClick={() => navigateManualAdd(isWishList)} style={{ padding: '10px 20px', backgroundColor: '#34C759', color: 'white', border: 'none', borderRadius: 5 }}>Add Manually</button>
        </div>
      </div>
    );
  }

  return (
    <div style={fullScreenStyle}>
      {/* Quagga will inject <video> and canvases into this element */}
      <div
        ref={scannerRef}
        id="interactive"
        style={{ width: '100%', height: '100%', position: 'relative' }}
      />

      {/* Visual scanning overlay (kept on top of Quagga overlay for consistent UX) */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: '80%', height: 200, border: '2px solid #00FF00', borderRadius: 10, pointerEvents: 'none', zIndex: 1000
      }} />

      {/* corner markers */}
      {[
        { top: 'calc(50% - 100px)', left: 'calc(10% - 10px)' },
        { top: 'calc(50% - 100px)', right: 'calc(10% - 10px)' },
        { bottom: 'calc(50% - 100px)', left: 'calc(10% - 10px)' },
        { bottom: 'calc(50% - 100px)', right: 'calc(10% - 10px)' }
      ].map((pos, i) => (
        <div key={i} style={{ position: 'absolute', ...(pos as any), width: 20, height: 20, border: '3px solid #00FF00', borderRadius: 3, pointerEvents: 'none', zIndex: 1001 }} />
      ))}

      {/* Controls / status */}
      <div style={controlsStyle}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 10 }}>
          <button onClick={navigateMlScanner} style={{ padding: '8px 16px', backgroundColor: 'rgba(0,122,255,0.8)', color: 'white', border: 'none', borderRadius: 5 }}>Use ML</button>
          <button onClick={() => navigateManualAdd(isWishList)} style={{ padding: '8px 16px', backgroundColor: 'rgba(52,199,89,0.8)', color: 'white', border: 'none', borderRadius: 5 }}>Add Manually</button>
        </div>
        <div>
          {ean ? `Barcode: ${ean}` : (scanning ? 'Scanning for barcodes...' : 'Point your camera at a barcode')}
        </div>
      </div>

      {/* Force video & canvas to align and fill the container */}
      <style>{`
        #interactive video, #interactive canvas {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
      `}</style>
    </div>
  );
}
