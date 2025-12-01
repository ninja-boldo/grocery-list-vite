import './App.css';
import Container from './comp/Container';
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import ErrorContainer from './comp/ErrorContainer';
import DropdownComp from './comp/Dropdown';
import { useNavigate } from 'react-router-dom';
import StyledButton from './comp/StyledButton';
import { Bars3Icon } from '@heroicons/react/24/outline';
import SidebarComp from "./comp/Sidebar";
import InfoContainer from './comp/InfoContainer';

// ============================================================================
// Types
// ============================================================================
interface Item {
  text: string | null;
  subgroups: string | null;
  classname: string | null;
  count: number;
  perish_dates: string[] | null;
}

// ============================================================================
// Constants
// ============================================================================
const PHONE_WIDTH = 500;
const TRANSCRIPTION_TIMEOUT = 10000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

// ============================================================================
// API Utilities - Self-healing with retry logic
// ============================================================================
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function apiCall<T>(
  url: string, 
  options?: RequestInit, 
  retries = RETRY_ATTEMPTS
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries - 1) await sleep(RETRY_DELAY * (attempt + 1));
    }
  }
  throw lastError;
}

// Fire-and-forget API call (for optimistic updates)
async function apiCallSafe(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Data Transformers
// ============================================================================
interface ApiResponse {
  item_list: [string, string, string, string, number, string[]][];
}

const transformItems = (data: ApiResponse): Item[] =>
  data.item_list.map(([, text, subgroups, classname, count, perish_dates]) => ({
    text,
    subgroups,
    classname,
    count,
    perish_dates: perish_dates ?? []
  }));

// ============================================================================
// Main Component
// ============================================================================
function App() {
  const navigate = useNavigate();
  
  // Reactive window width
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const isMobile = windowWidth <= PHONE_WIDTH;

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // State
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Item[]>([]);
  const [subgroups, setSubgroups] = useState<string[]>([]);
  const [classnames, setClassnames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState<string | null>(null);
  
  // Refs for audio recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const transcriptionTimer = useRef<NodeJS.Timeout | null>(null);

  // ========== Data Fetching ==========
  const fetchItems = useCallback(async (subgroup?: string | null, classname?: string | null) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({ only_wish_list: 'false' });
      if (subgroup) params.set('subgroups', subgroup);
      if (classname) params.set('classnames', classname);
      
      const response = await apiCall<ApiResponse>(`/api/fetch_items?${params}`);
      setData(transformItems(response));
      console.warn("got this as a fetch response: " + transformItems(response))
      if (data.length === 0){
        
        //setError("there are no items in the database")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch items');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchMetadata = useCallback(async () => {
    const [subRes, classRes] = await Promise.allSettled([
      apiCall<{ subgroups: string[] }>('/api/fetch_subgroups'),
      apiCall<{ classnames: string[] }>('/api/fetch_classnames')
    ]);
    
    if (subRes.status === 'fulfilled') setSubgroups(subRes.value.subgroups);
    if (classRes.status === 'fulfilled') setClassnames(classRes.value.classnames);
  }, []);

  // ========== Item Operations (Optimistic Updates) ==========
  const updateItemCount = useCallback(async (item: Item, delta: number) => {
    if (!item.text) return;
    
    const newCount = item.count + delta;
    
    // Optimistic update
    setData(prev => prev.map(i => 
      i.text === item.text ? { ...i, count: Math.max(0, newCount) } : i
    ));
    
    // API call
    const wishList = delta < 0 ? 'true' : 'false';
    const success = await apiCallSafe(
      `/api/add_ean_to_list/?item_name=${encodeURIComponent(item.text)}&count=${delta > 0 ? '+' : ''}${delta}&wish_list=${wishList}`
    );
    
    // Rollback on failure
    if (!success) {
      setError('Failed to update item');
      setData(prev => prev.map(i => 
        i.text === item.text ? { ...i, count: item.count } : i
      ));
    }
    
    // Reload if item removed (count reached 0)
    if (success && newCount <= 0) {
      setTimeout(() => window.location.reload(), 100);
    }
  }, []);

  const increaseItem = useCallback((item: Item) => updateItemCount(item, 1), [updateItemCount]);
  const decreaseItem = useCallback((item: Item) => updateItemCount(item, -1), [updateItemCount]);

  // ========== Recording ==========
  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: { channelCount: 1, sampleRate: 16000 } 
    });
    
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
      ? 'audio/webm;codecs=opus' 
      : 'audio/webm';
    
    const recorder = new MediaRecorder(stream, { mimeType });
    recordedChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorderRef.current = recorder;
    recorder.start(1000);
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) {
        resolve(new Blob());
        return;
      }

      recorder.onstop = () => {
        const audioBlob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        setIsRecording(false);
        resolve(audioBlob);
      };

      recorder.stop();
    });
  }, []);

  const handleRecording = useCallback(async () => {
    setError(null);
    
    try {
      if (!isRecording) {
        await startRecording();
      } else {
        setIsLoading(true);
        
        const blob = await stopRecording();
        if (blob.size === 0) {
          setError('No audio recorded');
          return;
        }
        
        const formData = new FormData();
        formData.append('file', new File([blob], 'recording.webm', { type: blob.type }));
        
        const params = new URLSearchParams({ only_wish_list: 'false' });
        params.set('ListTypesInput', "item_list");

        const result = await apiCall<{ transcribed_text: string }>(`/api/transcribe?${params}`, {
          method: 'POST',
          body: formData
        });
        
        setTranscription(result.transcribed_text);
        
        // Auto-clear transcription
        if (transcriptionTimer.current) clearTimeout(transcriptionTimer.current);
        transcriptionTimer.current = setTimeout(() => setTranscription(null), TRANSCRIPTION_TIMEOUT);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recording failed');
      setIsRecording(false);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    } finally {
      setIsLoading(false);
    }
  }, [isRecording, startRecording, stopRecording]);

  // ========== Navigation ==========
  const navigateScanner = useCallback((count: number) => {
    navigate(`/scanner?text=&count=${encodeURIComponent(count)}`);
  }, [navigate]);

  // ========== Effects ==========
  useEffect(() => {
    fetchItems();
    fetchMetadata();
  }, [fetchItems, fetchMetadata]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (transcriptionTimer.current) clearTimeout(transcriptionTimer.current);
    };
  }, []);

  // ========== Memoized Components ==========
  const itemList = useMemo(() => 
    data.map((item, idx) => (
      <Container
        key={`${item.text}-${idx}`}
        text={item.text}
        subgroups={item.subgroups}
        count={item.count}
        classname={item.classname}
        perish_dates={item.perish_dates}
        onClickIncrease={increaseItem}
        onClickDecrease={decreaseItem}
        style=""
      />
    )),
  [data, increaseItem, decreaseItem]);

  // ========== Render ==========
  if (isLoading && data.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-cyan-400 text-lg">Loading...</div>
      </div>
    );
  }

  let displayError = null;
  let noItemsAvailable: boolean = false;
  if(error?.includes('there are no items in the database')){
      displayError = null;  //'No items in database' 
      noItemsAvailable = true;

    }
  else{
    displayError = error;
  }

    
  return (
    <div className="flex flex-col min-h-screen">
      {/* Sidebar - always rendered, visibility controlled by CSS transform */}
      <SidebarComp isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      {displayError ? (
        <ErrorContainer text={displayError} />
      ) : (
        <>
          {/* Header Bar - transparent background */}
          <header className="flex items-center h-14 sm:h-16 px-3 sm:px-6 gap-3 sm:gap-4">
            {/* Sidebar Toggle */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-slate-700/50 transition-colors flex-shrink-0"
            >
              <Bars3Icon className="h-6 w-6 text-white" />
            </button>

            {/* Dropdowns */}
            <DropdownComp 
              task="subgroups" 
              text="subs" 
              elements={subgroups} 
              onClickElement={fetchItems} 
              onClickReset={fetchItems} 
              style="" 
            />

            {!isMobile && (
              <DropdownComp 
                task="classnames" 
                text="class" 
                elements={classnames} 
                onClickElement={fetchItems} 
                onClickReset={fetchItems} 
                style="" 
              />
            )}

            {/* Add/Remove Buttons */}
            <div className="flex gap-2">
              <StyledButton 
                text="+" 
                onClick={() => navigateScanner(1)} 
                className="" 
              />
              <StyledButton 
                text="-" 
                onClick={() => navigateScanner(-1)} 
                className="" 
              />
            </div>

            {/* Recording Button */}
            <button
              onClick={handleRecording}
              disabled={isLoading}
              className={`px-3 sm:px-4 py-2 rounded-lg text-white font-medium text-sm transition-colors flex-shrink-0 ${
                isRecording 
                  ? 'bg-red-500 hover:bg-red-600 animate-pulse' 
                  : 'bg-blue-500 hover:bg-blue-600'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isLoading ? '...' : isRecording ? 'Stop' : 'Record'}
            </button>

            {/* Transcription result - inline on desktop, below on mobile */}
            {transcription && (
              <div className="hidden sm:block max-w-xs p-2 bg-green-100 border border-green-300 rounded text-xs">
                <p className="text-green-700 truncate">{transcription}</p>
              </div>
            )}
          </header>

          {/* Mobile transcription result */}
          {transcription && isMobile && (
            <div className="mx-3 mt-2 p-2 bg-green-100 border border-green-300 rounded text-xs">
              <p className="font-semibold text-green-800">Transcribed:</p>
              <p className="text-green-700">{transcription}</p>
            </div>
          )}

          {/* Main Content */}
          <main className="flex-1 p-3 sm:p-4 md:p-6">
            <div className="max-w-4xl mx-auto">
              {noItemsAvailable ? (
                <InfoContainer text={"No items available in the database.\nSo perhaps add one."} />
              ) : (
                itemList
              )}
            </div>
          </main>
        </>
      )}
    </div>
  );
}

export default App;