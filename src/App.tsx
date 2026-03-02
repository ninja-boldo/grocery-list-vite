import './App.css';
import Container from './comp/other/Container';
import { useCallback, useEffect, useState, useRef } from 'react';
import ErrorContainer from './comp/utils/ErrorContainer';
import { useNavigate } from 'react-router-dom';
import SidebarComp from "./comp/other/Sidebar";
import InfoContainer from './comp/utils/InfoContainer';
import AttributionNotice from './comp/utils/AttributionNotice';
import VoiceRecorder from './comp/utils/VoiceRecorder';
import { Virtuoso } from 'react-virtuoso'
import TopBar from './comp/other/TopBar';
import { transformItems } from './lib/utils';
import { PageModes, type ApiResponse } from './lib/utils';
// ============================================================================
// Types
// ============================================================================
export interface Item {
  ean: string,
  text: string | null;
  subgroups: string | null;
  classname: string | null;
  count: number;
  perish_dates: string[] | null;
  imageUrl: string;
  tags: string[] | null;
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
      console.log(`Attempt ${attempt + 1}/${retries}`);
      
      const response = await fetch(url, options);
      console.log("Fetch completed, status:", response.status, response.statusText);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      // Get raw text first
      const rawText = await response.text();
      
      // Try to parse
      const parsed = JSON.parse(rawText);
      
      return parsed;
      
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`Attempt ${attempt + 1} FAILED:`, lastError.message);
      console.error("Error object:", err);
      
      if (attempt < retries - 1) {
        const delay = RETRY_DELAY * (attempt + 1);
        await sleep(delay);
      }
    }
  }
  
  console.error("========== ALL RETRIES FAILED ==========");
  throw lastError;
}


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
  const [, setClassnames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [, setCurrentItemCount] = useState<number>(0);
  const [hasMoreData, setHasMoreData] = useState<boolean>(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [sortOrder, setSortOrder] = useState<string>("new-old")
  const [subgroupsToSearch, setSubgroupsToSearch] = useState<string>("");
  
  const skipCountRef = useRef(0);
  const newItemsPerFetch = 20;
  const hasInitialFetchedRef = useRef(false);

  
  // Refs for audio recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const transcriptionTimer = useRef<NodeJS.Timeout | null>(null);


  useEffect(() => {
  const loadingState = transformItems({ "items": [
      { "ean": "loading-0", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: ""},
      { "ean": "loading-1", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: ""},
      { "ean": "loading-2", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: ""},
      { "ean": "loading-3", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: ""},
      { "ean": "loading-4", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: ""},
      { "ean": "loading-5", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: ""},
      { "ean": "loading-6", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: ""},
      { "ean": "loading-7", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: ""},
      { "ean": "loading-8", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: ""},
      { "ean": "loading-9", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: ""},
      { "ean": "loading-10", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: "" },
      { "ean": "loading-11", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: "" },
      { "ean": "loading-12", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: "" },
      { "ean": "loading-13", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: "" },
      { "ean": "loading-14", "text": "Loading...", "subgroups": null, "classname": null, "count": 0, "perish_dates": [], "imageUrl": "", tags: "" }
    ]
  })
  
  setData(loadingState);
}, []); // Empty array means "run once on mount"
  

  // ========== Data Fetching ==========
  const filterFetchItems = async(subgroupFilter: string | null, sortOrderFilter: string | undefined) => {
    // Update state for future fetches
    if(subgroupFilter){
      setSubgroupsToSearch(subgroupFilter)
    }
    if(sortOrderFilter){
      setSortOrder(sortOrderFilter)
    }
    
    // Reset data and fetch with NEW values immediately
    setData([])
    skipCountRef.current = 0
    setHasMoreData(true)
    
    // Pass values directly instead of waiting for state update
    fetchItemsWithParams(subgroupFilter || subgroupsToSearch, sortOrderFilter)
  }
const fetchItemsWithParams = useCallback(async (subgroupsParam?: string, sortOrderParam?: string) => {
  // Prevent concurrent fetches
  if (isLoading) {
    console.log("Fetch already in progress, skipping");
    return;
  }
  
  setIsLoading(true);
  setError(null);
  
  try {
    const params = new URLSearchParams({ only_wish_list: 'false' });
    
    // Use parameters if provided, otherwise fall back to state
    const subgroupsToUse = subgroupsParam !== undefined ? subgroupsParam : subgroupsToSearch;
    const sortOrderToUse = sortOrderParam !== undefined ? sortOrderParam : sortOrder;
    
    if (subgroupsToUse) params.set('subgroups', subgroupsToUse);
    if (sortOrderToUse) params.set('sortOrder', sortOrderToUse);
    
    // Use ref instead of state
    params.set('skip', skipCountRef.current.toString());
    params.set('limit', newItemsPerFetch.toString());
    
    const url = `/api/fetch_items?${params}`;
    console.log("Calling API with URL:", url, "Skip:", skipCountRef.current);
    
    const response = await apiCall<ApiResponse>(url);
    console.log("API returned items:", response.items.length);
    
    if(response.items.length === 0){
      setHasMoreData(false);
      console.log("No more items available");
    } else {
      // Update ref
      skipCountRef.current += response.items.length;
      console.log("New skip count:", skipCountRef.current);
      
      const newItems = transformItems(response);
      
      // Deduplicate based on EAN when appending
      setData(prev => {
        const isPlaceholder = prev.length > 0 && prev[0].ean.startsWith("loading-");
        
        if (isPlaceholder) return newItems;

        const seen = new Set();
        return [...prev, ...newItems].filter(item => {
          const key = `${item.ean}-${item.text}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
      
      setCurrentItemCount(prev => prev + response.items.length);
    }
  } catch (err) {
    console.error("========== FETCH ITEMS ERROR ==========");
    console.error("Error caught:", err);
    const errorMessage = err instanceof Error ? err.message : 'Failed to fetch items';
    console.error("Setting error message:", errorMessage);
    setError(errorMessage);
  } finally {
    setIsLoading(false);
    setIsInitialLoad(false);
  }
}, [isLoading, subgroupsToSearch, sortOrder]);

const fetchItems = useCallback(async () => {
  return fetchItemsWithParams();
}, [fetchItemsWithParams]); // Add isLoading as dependency

  const loadMoreItems = useCallback(() => {
    console.log("loading more items")
    // Only allow loadMore AFTER initial load is complete and not currently loading
    if (!isInitialLoad && !isLoading) {
      console.log("loadMoreItems called");
      fetchItems();
    } else {
      console.log("loadMoreItems skipped - initial load:", isInitialLoad, "isLoading:", isLoading);
    }
  }, [fetchItems, isInitialLoad, isLoading]);

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
    if (!hasInitialFetchedRef.current) {
      hasInitialFetchedRef.current = true;
      fetchItems(); 
      fetchMetadata();
      console.log("========== INITIAL USEEFFECT COMPLETE ==========");
    }
  }, [fetchItems, fetchMetadata]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (transcriptionTimer.current) clearTimeout(transcriptionTimer.current);
    };
  }, []);

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

  console.log("Rendering main UI - displayError:", displayError, "noItemsAvailable:", noItemsAvailable);
    
  return (
  <div className='h-screen '>
    {/* Sidebar - always rendered, visibility controlled by CSS transform */}
    <SidebarComp isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    
    {displayError ? (
      <ErrorContainer text={displayError} />
    ) : (
      <div className="h-screen">
        <TopBar
          sidebarOpen={sidebarOpen}
          onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
          subgroups={subgroups}
          onFilter={filterFetchItems}
          onReset={fetchItems}
          onScanIncrease={() => navigateScanner(1)}
          onScanDecrease={() => navigateScanner(-1)}
          items={data}
          setItems={setData}
          mode={PageModes.HomePage}
        />

        {/* Main Content with top padding */}
        <div className=" flex-1 p-3 sm:p-4 md:p-6">
          <div className="max-w-4xl mx-auto ">
            {noItemsAvailable ? (
              <InfoContainer text={"No items available in the database.\nSo perhaps add one."} />
            ) : (
              <Virtuoso
                style={{ height: '85vh' }}
                data={data}
                endReached={() => {
                  if (hasMoreData && !isLoading) {
                    loadMoreItems();
                  }
                }}
                itemContent={(idx, item) => (
                  <Container
                    key={idx}
                    text={item.text}
                    subgroups={item.subgroups}
                    count={item.count}
                    classname={item.classname}
                    perish_dates={item.perish_dates}
                    imageUrl={item.imageUrl}
                    ean={item.ean}
                    onClickIncrease={increaseItem}
                    onClickDecrease={decreaseItem}
                    tags={item.tags}
                    style=""
                  />
                )}
              />
            )}
          </div>
        </div>
      </div>
    )}

    {/* Voice Recorder */}
    <div className='flex flex-row'>
      <VoiceRecorder 
        isRecording={isRecording}
        isLoading={isLoading}
        onRecordClick={handleRecording}
      />

      {/* Transcription result - inline on desktop, below on mobile */}
      {transcription && (
        <div className="hidden sm:block max-w-xs p-2 bg-green-100 border border-green-300 rounded text-xs">
          <p className="text-green-700 truncate">{transcription}</p>
        </div>
      )}

      {/* Mobile transcription result */}
      {transcription && isMobile && (
        <div className="mx-3 mt-2 p-2 bg-green-100 border border-green-300 rounded text-xs">
          <p className="font-semibold text-green-800">Transcribed:</p>
          <p className="text-green-700">{transcription}</p>
        </div>
      )}
    </div>

    {/* Floating Attribution Notice */}
    <AttributionNotice floating />

  </div>
);
}

export default App;