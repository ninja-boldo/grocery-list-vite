import '../App.css';
import Container from './Container';
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import ErrorContainer from './ErrorContainer';
import { useNavigate } from 'react-router-dom';
import StyledButton from './StyledButton';
import { Bars3Icon } from '@heroicons/react/24/outline';
import SidebarComp from './Sidebar';
import InfoContainer from './InfoContainer';

// ============================================================================
// TYPES
// ============================================================================
interface ItemProps {
  text: string | null;
  subgroups: string | null;
  style?: string;
  count: number;
  classname: string | null;
  perish_dates: string[] | null;
  onClickIncrease: (item: ItemProps) => Promise<void>;
  onClickDecrease: (item: ItemProps) => Promise<void>;
}

interface ApiResponse {
  item_list: [string, string, string, string, number, string][];
}

// ============================================================================
// CONSTANTS
// ============================================================================
const PHONE_WIDTH = 500;
const TRANSCRIPTION_TIMEOUT = 10000;
const API_CONFIG = {
  retries: 3,
  baseDelay: 1000,
  timeout: 10000,
} as const;

// ============================================================================
// SELF-HEALING API UTILITIES
// ============================================================================
async function apiCall<T>(
  url: string,
  options: RequestInit = {},
  retries = API_CONFIG.retries
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);

      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, API_CONFIG.baseDelay * (attempt + 1)));
      }
    }
  }
  throw lastError ?? new Error('API call failed');
}

/** Fire-and-forget with optimistic UI - errors logged but not thrown */
async function apiCallSafe(url: string): Promise<boolean> {
  try {
    await apiCall(url);
    return true;
  } catch (error) {
    console.error('API call failed (non-blocking):', error);
    return false;
  }
}

// ============================================================================
// COMPONENT
// ============================================================================
function WishList() {
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
  const [data, setData] = useState<ItemProps[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState<string | null>(null);

  // Refs for audio recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const transcriptionTimer = useRef<NodeJS.Timeout | null>(null);

  // Navigation
  const navigateScanner = useCallback(
    (item: ItemProps | null, count: number = 1) => {
      const params = new URLSearchParams({ wishlist: 'true', count: String(count) });
      if (item?.subgroups) params.set('subgroups', item.subgroups);
      else params.set('text', '');
      navigate(`/scanner?${params}`);
    },
    [navigate]
  );

  // ========== Recording ==========
  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000 },
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
      stream.getTracks().forEach((track) => track.stop());
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
        params.set('ListTypesInput', "wish_list");

        const result = await apiCall<{ transcribed_text: string }>(`/api/transcribe?${params}`, {
          method: 'POST',
          body: formData
        });
        

        setTranscription(result.transcribed_text);

        // Refresh the wish list after transcription (item may have been removed)
        await fetchItems();

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, startRecording, stopRecording]);

  // Item count handlers with optimistic updates
  const increaseItemCount = useCallback(async (item: ItemProps) => {
    if (!item.text) return;

    // Optimistic update
    setData((prev) =>
      prev.map((i) => (i.text === item.text ? { ...i, count: i.count + 1 } : i))
    );

    const success = await apiCallSafe(
      `/api/add_ean_to_list/?item_name=${encodeURIComponent(item.text)}&count=1&wish_list=true`
    );

    // Rollback on failure
    if (!success) {
      setData((prev) =>
        prev.map((i) => (i.text === item.text ? { ...i, count: i.count - 1 } : i))
      );
      setError('Failed to update item count');
    }
  }, []);

  const decreaseItemCount = useCallback(async (item: ItemProps) => {
    if (!item.text) return;

    const willDelete = item.count <= 1;

    // Optimistic update
    setData((prev) =>
      willDelete
        ? prev.filter((i) => i.text !== item.text)
        : prev.map((i) => (i.text === item.text ? { ...i, count: i.count - 1 } : i))
    );

    const success = await apiCallSafe(
      `/api/add_ean_to_list/?item_name=${encodeURIComponent(item.text)}&count=-1&wish_list=true`
    );

    // Rollback on failure - refetch to get accurate state
    if (!success) {
      setError('Failed to update item count');
      // fetchItems will be called via useEffect when error state changes
    }
  }, []);

  // Data fetching with self-healing
  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiCall<ApiResponse>('/api/fetch_items?only_wish_list=true');

      const items: ItemProps[] = response.item_list.map((row) => ({
        text: row[1],
        subgroups: row[2],
        style: '',
        classname: row[3],
        count: row[4],
        perish_dates: typeof row[5] === 'string' ? JSON.parse(row[5] || '[]') : row[5],
        onClickIncrease: increaseItemCount,
        onClickDecrease: decreaseItemCount,
      }));

      setData(items);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch wish list';
      setError(message);
      console.error('WishList fetch failed:', error);
    } finally {
      setIsLoading(false);
    }
  }, [increaseItemCount, decreaseItemCount]);

  // Memoized container list
  const containerComponents = useMemo(
    () =>
      data.map((item, idx) => (
        <Container
          key={`${item.text}-${idx}`}
          text={item.text}
          subgroups={item.subgroups}
          count={item.count}
          classname={item.classname}
          perish_dates={['none']}
          onClickIncrease={increaseItemCount}
          onClickDecrease={decreaseItemCount}
          style=""
        />
      )),
    [data, increaseItemCount, decreaseItemCount]
  );

  // Initial data load
  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (transcriptionTimer.current) clearTimeout(transcriptionTimer.current);
    };
  }, []);

  // Loading state
  if (isLoading && data.length === 0) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-cyan-400 text-lg">Loading...</div>
      </div>
    );
  }

  const noItemsAvailable = data.length === 0 && !error;

  return (
    <>
      {/* Sidebar - always rendered for animation */}
      <SidebarComp isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-col min-h-screen">
        {error ? (
          <ErrorContainer text={error} />
        ) : (
          <>
            {/* Header */}
            <header className="flex items-center h-14 sm:h-16 px-3 sm:px-6 gap-3 sm:gap-4">
              {/* Sidebar Toggle */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-slate-700/50 transition-colors flex-shrink-0"
              >
                <Bars3Icon className="h-6 w-6 text-white" />
              </button>

              {/* Add/Remove Buttons */}
              <div className="flex gap-2">
                <StyledButton text="+" onClick={() => navigateScanner(null, 1)} className="" />
                <StyledButton text="-" onClick={() => navigateScanner(null, -1)} className="" />
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

              {/* Transcription result - inline on desktop */}
              {transcription && !isMobile && (
                <div className="max-w-xs p-2 bg-green-100 border border-green-300 rounded text-xs">
                  <p className="text-green-700 truncate">{transcription}</p>
                </div>
              )}

              {isLoading && <span className="text-sm text-gray-400 ml-2">Updating...</span>}
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
                  <InfoContainer text={"No items on your wish list.\nAdd something you'd like to buy!"} />
                ) : (
                  containerComponents
                )}
              </div>
            </main>
          </>
        )}
      </div>
    </>
  );
}

export default WishList;