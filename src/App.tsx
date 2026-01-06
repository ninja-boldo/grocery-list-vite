import './App.css';
import Container from './comp/Container';
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import ErrorContainer from './comp/ErrorContainer';
import DropdownComp from './comp/Dropdown';
import MergedDropdown from './comp/MergedDropdown';
import { useNavigate } from 'react-router-dom';
//import StyledButton from './comp/StyledButton';
import SplitButton from './comp/SplitButton';
import { Bars3Icon } from '@heroicons/react/24/outline';
import SidebarComp from "./comp/Sidebar";
import InfoContainer from './comp/InfoContainer';
import AttributionNotice from './comp/AttributionNotice';

console.log("========== APP.TSX MODULE LOADED ==========");

// ============================================================================
// Types
// ============================================================================
interface Item {
  text: string | null;
  subgroups: string | null;
  classname: string | null;
  count: number;
  perish_dates: string[] | null;
  imageUrl: string;
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
  console.log(`========== API CALL START ==========`);
  console.log("URL:", url);
  console.log("Retries:", retries);
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`Attempt ${attempt + 1}/${retries}`);
      
      const response = await fetch(url, options);
      console.log("Fetch completed, status:", response.status, response.statusText);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      // Get raw text first
      const rawText = await response.text();
      console.log("Raw response (first 200 chars):", rawText.substring(0, 200));
      
      // Try to parse
      const parsed = JSON.parse(rawText);
      console.log("Successfully parsed JSON");
      console.log("Parsed data type:", typeof parsed);
      console.log("Is array?", Array.isArray(parsed));
      
      return parsed;
      
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`Attempt ${attempt + 1} FAILED:`, lastError.message);
      console.error("Error object:", err);
      
      if (attempt < retries - 1) {
        const delay = RETRY_DELAY * (attempt + 1);
        console.log(`Waiting ${delay}ms before retry...`);
        await sleep(delay);
      }
    }
  }
  
  console.error("========== ALL RETRIES FAILED ==========");
  throw lastError;
}

// ============================================================================
// Data Transformers
// ============================================================================
interface ApiItem {
  text: string;
  subgroups: string | null;
  classname: string | null;
  count: number;
  perish_dates: string[] | null;
  imageUrl: string;
}

interface ApiResponse {
  items: ApiItem[];
}

const transformItems = (data: ApiResponse): Item[] => {
  console.log("========== TRANSFORM ITEMS ==========");
  console.log("Input data:", data);
  console.log("Has items property?", data && 'items' in data);
  console.log("Items is array?", data?.items && Array.isArray(data.items));
  
  const transformed = data.items.map((item) => ({
    text: item.text,
    subgroups: item.subgroups,
    classname: item.classname,
    count: item.count,
    perish_dates: item.perish_dates ?? [],
    imageUrl: item.imageUrl
  }));
  
  console.log("Transformed items count:", transformed.length);
  return transformed;
};

// ============================================================================
// Main Component
// ============================================================================
function App() {
  console.log("========== APP COMPONENT RENDER START ==========");
  
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
  
  console.log("Current state - data:", data, "error:", error, "isLoading:", isLoading);
  
  // Refs for audio recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const transcriptionTimer = useRef<NodeJS.Timeout | null>(null);

  // ========== Data Fetching ==========
  const fetchItems = useCallback(async (subgroup?: string | null, classname?: string | null) => {
    console.log("========== FETCH ITEMS CALLED ==========");
    console.log("subgroup:", subgroup, "classname:", classname);
    
    setIsLoading(true);
    console.log("Set isLoading = true");
    
    setError(null);
    console.log("Set error = null");
    
    try {
      console.log("Building query params...");
      const params = new URLSearchParams({ only_wish_list: 'false' });
      if (subgroup) params.set('subgroups', subgroup);
      if (classname) params.set('classnames', classname);
      
      const url = `/api/fetch_items?${params}`;
      console.log("Calling API with URL:", url);
      
      const response = await apiCall<ApiResponse>(url);
      console.log("API call returned successfully");
      console.log("Raw API response:", response);
      
      const items = transformItems(response);
      console.log("Items transformed:", items);
      
      setData(items);
      console.log("Set data with", items.length, "items");
      
      if (items.length === 0) {
        console.log("No items returned");
      }
    } catch (err) {
      console.error("========== FETCH ITEMS ERROR ==========");
      console.error("Error caught:", err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch items';
      console.error("Setting error message:", errorMessage);
      setError(errorMessage);
    } finally {
      console.log("========== FETCH ITEMS FINALLY ==========");
      setIsLoading(false);
      console.log("Set isLoading = false");
    }
  }, []);

  const fetchMetadata = useCallback(async () => {
    console.log("========== FETCH METADATA CALLED ==========");
    
    const [subRes, classRes] = await Promise.allSettled([
      apiCall<{ subgroups: string[] }>('/api/fetch_subgroups'),
      apiCall<{ classnames: string[] }>('/api/fetch_classnames')
    ]);
    
    console.log("Subgroups result:", subRes);
    console.log("Classnames result:", classRes);
    
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
    
    try {
      await fetch('/api/add_ean_to_list/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8'
        },
        body: JSON.stringify({
          item_name: item.text,
          count: delta,
          subgroups: item.subgroups || '',
          wish_list: wishList
        })
      });
      
      // Reload if item removed (count reached 0)
      if (newCount <= 0) {
        setTimeout(() => window.location.reload(), 100);
      }
    } catch (err) {
      // Rollback on failure
      setError('Failed to update item');
      setData(prev => prev.map(i => 
        i.text === item.text ? { ...i, count: item.count } : i
      ));
      console.error('Error updating item:', err);
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
    console.log("========== INITIAL USEEFFECT RUNNING ==========");
    console.log("About to call fetchItems()");
    fetchItems();
    console.log("About to call fetchMetadata()");
    fetchMetadata();
    console.log("========== INITIAL USEEFFECT COMPLETE ==========");
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
  console.log("About to create itemList memo");
  console.log("Current data:", data);
  console.log("Data type:", typeof data);
  console.log("Is array?", Array.isArray(data));
  console.log("Data length:", data?.length);

  const itemList = useMemo(() => {
    console.log("========== USEMEMO ITEMLIST EXECUTING ==========");
    console.log("Data in useMemo:", data);
    console.log("Data is array?", Array.isArray(data));
    
    if (!data || !Array.isArray(data)) {
      console.error("Data is not an array:", data);
      return [];
    }
    
    console.log(`Mapping ${data.length} items to Container components`);
    
    const containers = data.map((item, idx) => {
      console.log(`Creating container ${idx} for item:`, item.text);
      return (
        <Container
          key={`${item.text}-${idx}`}
          text={item.text}
          subgroups={item.subgroups}
          count={item.count}
          classname={item.classname}
          perish_dates={item.perish_dates}
          imageUrl={item.imageUrl}
          onClickIncrease={increaseItem}
          onClickDecrease={decreaseItem}
          style=""
        />
      );
    });
    
    console.log(`Created ${containers.length} container components`);
    return containers;
  }, [data, increaseItem, decreaseItem]);

  // ========== Render ==========
  console.log("Render decision - isLoading:", isLoading, "data.length:", data.length);
  
  if (isLoading && data.length === 0) {
    console.log("Rendering loading state");
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

  console.log("Rendering main UI - displayError:", displayError, "noItemsAvailable:", noItemsAvailable);
    
  return (
    <div className="flex flex-col min-h-screen mt-3">
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
              className="flex items-center justify-center w-15 h-15 rounded-lg hover:bg-slate-700/50 transition-colors flex-shrink-0"
            >
              <Bars3Icon className="h-10 w-10 text-white" />
              
            </button>

            {/* Dropdowns */}
            { !isMobile && (
            <div className='flex flex-col'>
              
              
              <div className='m-1'>
                <DropdownComp 
                  task="subgroups" 
                  text="subs" 
                  elements={subgroups} 
                  onClickElement={fetchItems} 
                  onClickReset={fetchItems} 
                  style="" 
                />
              </div>
              <div className='m-1'>
                {(
                  <DropdownComp 
                    task="classnames" 
                    text="class" 
                    elements={classnames} 
                    onClickElement={fetchItems} 
                    onClickReset={fetchItems} 
                    style="" 
                  />
                )}
              </div>
            </div>
            )}
            {/* Add/Remove Buttons */}
            {/*
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
            */}

            <SplitButton 
            onClickUpper={() => navigateScanner(1)}
            onClickBottom={() => navigateScanner(-1)}
            
             />
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
      
      {/* Floating Attribution Notice */}
      <AttributionNotice floating />
    </div>
  );
}

export default App;