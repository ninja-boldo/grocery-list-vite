import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, NotFoundException, Result } from '@zxing/library';

export default function BarcodeScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [ean, setEan] = useState<string>('');
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    // Initialize code reader
    const codeReader = new BrowserMultiFormatReader();
    codeReaderRef.current = codeReader;

    // List available video input devices (cameras)
    codeReader.listVideoInputDevices()
      .then(videoInputDevices => {
        setDevices(videoInputDevices);
        if (videoInputDevices.length > 0) {
          setSelectedDeviceId(videoInputDevices[0].deviceId);
        }
      })
      .catch(console.error);

    // Cleanup on unmount
    return () => {
      codeReader.reset();
    };
  }, []);

  // Function to start scanning
  const startScanning = () => {
    if (!selectedDeviceId || !videoRef.current || !codeReaderRef.current) return;

    setScanning(true);
    codeReaderRef.current.decodeFromVideoDevice(
      selectedDeviceId,
      videoRef.current,
      (result: Result | undefined, error: any) => {
        if (result) {
          const text = result.getText();
          // Simple check: EAN-13 is 13 digits numeric
          if (/^\d{13}$/.test(text)) {
            setEan(text);
            setScanning(false); // stop scanning after detection
            codeReaderRef.current?.reset();
            sendEanToBackend(text);
          }
        }
        if (error && !(error instanceof NotFoundException)) {
          console.error(error);
        }
      }
    );
  };

  const sendEanToBackend = async (ean: string) => {
    try {
      const res = await fetch('/api/check_ean', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ean }),
      });
      if (!res.ok) throw new Error('Network error');
      const data = await res.json();
      console.log('Backend response:', data);
    } catch (err) {
      console.error('Error sending EAN:', err);
    }
  };

  // Stop scanning (reset)
  const resetScanner = () => {
    codeReaderRef.current?.reset();
    setEan('');
    setScanning(false);
  };

  return (
    <div>
      <h2>Barcode Scanner</h2>
      <div>
        <label htmlFor="deviceSelect">Choose camera:</label>
        <select
          id="deviceSelect"
          onChange={e => setSelectedDeviceId(e.target.value)}
          value={selectedDeviceId ?? ''}
          disabled={scanning}
        >
          {devices.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || device.deviceId}
            </option>
          ))}
        </select>
      </div>

      <video
        ref={videoRef}
        style={{ width: '100%', maxHeight: '300px', border: '1px solid black' }}
        muted
        autoPlay
        playsInline
      ></video>

      <div style={{ marginTop: 10 }}>
        {!scanning ? (
          <button onClick={startScanning} disabled={!selectedDeviceId}>
            Start Scanning
          </button>
        ) : (
          <button onClick={resetScanner}>Stop Scanning</button>
        )}
      </div>

      <div>
        <h3>EAN: {ean || 'No code detected yet'}</h3>
      </div>
    </div>
  );
}
