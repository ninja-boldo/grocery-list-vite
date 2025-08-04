import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, NotFoundException, Result } from '@zxing/library';
import { useLocation, useNavigate } from 'react-router-dom';

export default function FullScreenCameraScanner() {
  const navHook = useNavigate()

  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const [ean, setEan] = useState('');
  const [scanning, setScanning] = useState(true); // Auto-start scanning
   
  const [, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');

  useEffect(() => {
    // Set full screen styling
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.width = '100vw';
    document.body.style.height = '100vh';
    
    return () => {
      document.body.style.margin = '';
      document.body.style.padding = '';
      document.body.style.overflow = '';
      document.body.style.width = '';
      document.body.style.height = '';
    };
  }, []);

  const navigateMlScanner = () => {
    navHook("/scanner/ml")
  }

  // Get available cameras on component mount
  useEffect(() => {
    const getCameras = async () => {
      try {
        // First request camera permission to get device labels
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop()); // Stop the test stream
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        console.log('Available cameras:', videoDevices);
        setAvailableCameras(videoDevices);
        
        // Auto-select rear camera: prefer rear camera always
        if (videoDevices.length > 0) {
          // Try to find rear camera first, fallback to any camera
          const rearCamera = videoDevices.find(device => 
            device.label.toLowerCase().includes('back') || 
            device.label.toLowerCase().includes('rear') ||
            device.label.toLowerCase().includes('rück') ||
            (device.label.toLowerCase().includes('hinten') &&
            !device.label.toLowerCase().includes('Kamera von „iPhone'))
             );
          setSelectedCameraId(rearCamera?.deviceId || videoDevices[0].deviceId);
          
        }
      } catch (error) {
        console.error('Error getting cameras:', error);
        if (error && typeof error === 'object' && 'name' in error && 'message' in error) {
          console.error('Camera error details:', (error as { name: string; message: string }).name, (error as { name: string; message: string }).message);
        }
        
        // Fallback: try without specific device ID (prefer rear camera)
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
          });
          stream.getTracks().forEach(track => track.stop());
          setSelectedCameraId('fallback');
          setAvailableCameras([{
            deviceId: 'fallback',
            label: 'Rear Camera',
            kind: 'videoinput',
            groupId: '',
            toJSON: () => ({
              deviceId: 'fallback',
              label: 'Rear Camera',
              kind: 'videoinput',
              groupId: ''
            })
          } as MediaDeviceInfo]);
        } catch (fallbackError) {
          console.error('Fallback camera access failed:', fallbackError);
        }
      }
    };

    getCameras();
  }, []);

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  let subgroups = queryParams.get('subgroups');

  const sendEan = (ean: string) => {
      if(!subgroups){
        subgroups = ""
      }
      console.log("the parentsList read by use params are like this: " + subgroups)
      fetch( `/api/add_ean_to_list/?ean=${encodeURIComponent(ean)}&subgroups=${subgroups}` )
    }

  useEffect(() => {

  
    const goHome = () => {
      navHook("/")
    }
    
    if (!scanning || !selectedCameraId) return;

    const codeReader = new BrowserMultiFormatReader();
    codeReaderRef.current = codeReader;

    // Faster scanning
    (codeReader as BrowserMultiFormatReader & { _timeoutBetweenDecodingAttempts?: number })._timeoutBetweenDecodingAttempts = 500;

    const constraints = selectedCameraId === 'fallback' 
      ? {
          video: {
            facingMode: 'environment',
            width: { ideal: 1920, min: 640 },
            height: { ideal: 1080, min: 480 },
            frameRate: { ideal: 60, min: 30 },
          },
        }
      : {
          video: {
            deviceId: { exact: selectedCameraId },
            width: { ideal: 1920, min: 640 },
            height: { ideal: 1080, min: 480 },
            frameRate: { ideal: 60, min: 30 },
            // Removed non-standard properties
          },
        };

    navigator.mediaDevices.getUserMedia(constraints)
      .then(async (stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }

        // Apply additional camera settings for better performance
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && videoTrack.applyConstraints) {
          try {
            // Optionally, you can apply standard constraints here if needed
            await videoTrack.applyConstraints({});
          } catch (constraintError) {
            console.log('Advanced constraints not supported:', constraintError);
          }
        }

        // Optimized decoding with reduced overhead
        let lastDecodeTime = 0;
        const DECODE_THROTTLE = 100; // ~60fps max decode attempts

        codeReader.decodeFromVideoElementContinuously(videoRef.current!, (result: Result | undefined, err: unknown) => {
          const now = performance.now();
          if (now - lastDecodeTime < DECODE_THROTTLE) return; // Throttle decoding
          lastDecodeTime = now;
          console.log("selected the camera with the id: " + selectedCameraId)

          if (result) {
            const text = result.getText();

            if (/^\d{8,14}$/.test(text)) {

              setEan(text);
              setScanning(false);

              console.log("invoking send ean")
              sendEan(text)
              console.log("send ean invoked")

              setTimeout(() => {
                codeReader.reset();
                goHome();
              }, 1000);

              console.log('Barcode detected:', text);
              
              // Haptic feedback if available
              if ('vibrate' in navigator) {
                try{
                  navigator.vibrate(200);
                }
                catch{
                  { /* empty */ }
                }
              }
            }
          }
          // Suppress most error logging for performance
          if (err && !(err instanceof NotFoundException) && Math.random() < 0.01) {
            console.error(err);
          }
        });
      })
      .catch((error) => {
        console.error('Camera access error:', error);
        setScanning(false);
      });

    return () => {
      codeReader.reset();
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };
  }, [navHook, scanning, selectedCameraId]);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'black',
      overflow: 'hidden',
    }}>
      <video
        ref={videoRef}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          backgroundColor: 'black',
          willChange: 'transform', 
          transform: 'translateZ(0)', // Force hardware acceleration
        }}
        muted
        playsInline
        autoPlay
        preload="none"
      />

      {/* Status text at bottom */}
      <div style={{
        position: 'fixed',
        bottom: 20,
        left: 0,
        right: 0,
        textAlign: 'center',
        color: 'white',
        textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
        fontSize: 24,
        fontWeight: 'bold',
        zIndex: 10000,
        padding: '0 20px',
      }}>

      <button onClick={navigateMlScanner}> use ml without bar code</button>
        {ean ? `Barcode: ${ean}` : 'Point your camera at a barcode'}
      </div>
    </div>
  );
}