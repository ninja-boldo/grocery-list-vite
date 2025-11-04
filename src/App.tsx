import './App.css';
import Container from './comp/Container';
import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import ErrorContainer from './comp/ErrorContainer';
import DropdownComp from './comp/Dropdown';
import { useNavigate } from 'react-router-dom';
import StyledButton from './comp/StyledButton';

import { Bars3Icon } from '@heroicons/react/24/outline'
import SidebarComp from "./comp/Sidebar"

interface Props {
  text: string | null;
  subgroups: string | null;
  style?: string;
  count: number;
  classname: string | null;
  perish_dates: string[] | null;
  onClickIncrease: (clickedNode: Props) => Promise<void>; 
  onClickDecrease: (clickedNode: Props) => Promise<void>; 
}

function App() {

  const getDimensions = () => ({ width: window.innerWidth, height: window.innerHeight });



  const usenav = useNavigate();

  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Props[]>([]);
  const [subgroups, setSubgroups] = useState<string[]>([]);
  const [classnames, setClassnames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [SidebarIsOpen, setSidebarIsOpen] = useState(false)

  // Updated audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptionResult, setTranscriptionResult] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { width, height } = getDimensions();
  const phoneWidth = 500;
  console.warn("these are your dimensions with width being: " + width + " and height being: " + height)


  const navigateScanner = useCallback((clickedNode: Props | null, count: number | null) => {

    if(!count){
      count = 1
    }
    if(clickedNode?.subgroups){
      const subgroups = clickedNode.subgroups || "";
      usenav(`/scanner?subgroups=${encodeURIComponent(subgroups)}&count=${encodeURIComponent(count)}`);
    } else {
      usenav(`/scanner?text=&count=${encodeURIComponent(count)}`);
    }
  }, [usenav]);

  
  // Improved audio recording functions
  const startRecording = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000, // Whisper prefers 16kHz
        } 
      });
      
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : 'audio/webm';
      
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      
      recordedChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderRef.current.start(1000); // Collect data every second
      setIsRecording(true);
      console.log("Recording started...");
      
    } catch (error) {
      console.error("Failed to start recording:", error);
      setError("Failed to access microphone. Please check permissions.");
    }
  };

  const stopRecording = (): Promise<Blob> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current) {
        resolve(new Blob());
        return;
      }

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(recordedChunksRef.current, { 
          type: "audio/webm" 
        });
        setIsRecording(false);
        resolve(audioBlob);
      };

      mediaRecorderRef.current.stop();
    });
  };

  const uploadAudio = async (blob: Blob, filename = "recording.webm"): Promise<unknown> => {
    const file = new File([blob], filename, { type: blob.type });
    const formData = new FormData();
    formData.append("file", file);

    console.log(`Uploading file: ${filename}, size: ${blob.size} bytes, type: ${blob.type}`);

    const response = await fetch("api/transcribe", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} - ${errorText}`);
    }
    
    return response.json();
  };

  const handleRecording = async () => {
    try {
      setError(null); // Clear any previous errors
      
      if (!isRecording) {
        // Start recording
        await startRecording();
      } else {
        // Stop recording and upload
        console.log("Stopping recording...");
        const blob = await stopRecording();
        
        if (blob.size === 0) {
          setError("No audio data recorded");
          return;
        }
        
        console.log("Recording stopped, uploading...");
        setIsLoading(true);
        
        const result = await uploadAudio(blob);
        console.log("Transcription result:", result);
        
        setTranscriptionResult((result as { transcribed_text: string }).transcribed_text);
        
        // Auto-clear transcription result after 10 seconds
        setTimeout(() => setTranscriptionResult(null), 10000);
      }
    } catch (error) {
      console.error("Recording/transcription error:", error);
      setError(error instanceof Error ? error.message : "Recording failed");
      setIsRecording(false);
      
      // Stop any ongoing recording on error
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    } finally {
      setIsLoading(false);
    }
  };

  const increaseItemCount = useCallback(async (clickedNode: Props) => {
      if(clickedNode.text){
        setIsLoading(true);
        try {
          await fetch(`/api/add_ean_to_list/?item_name=${encodeURIComponent(clickedNode.text)}&count=+1&wish_list=false`);
          // Instead of reloading, update state locally for better UX
          setData(prevData => 
            prevData.map(item => 
              item.text === clickedNode.text 
                ? { ...item, count: item.count + 1 }
                : item
            )
          );
        } catch (error) {
          console.error("Failed to increase count:", error);
          setError("Failed to update item count");
        } finally {
          setIsLoading(false);
        }
      } else {
        console.error("Increase: clickedNode.text is invalid:", clickedNode.text);
      }
    }, []);

  const decreaseItemCount = useCallback(async (clickedNode: Props) => {
    if (!clickedNode.text) {
      console.error("Decrease: clickedNode.text is invalid:", clickedNode.text);
      return;
    }
  
    setIsLoading(true);
    try {
      await fetch(
        `/api/add_ean_to_list/?item_name=${encodeURIComponent(
          clickedNode.text
        )}&count=-1&wish_list=true`
      );
  
      let shouldReload = false;
      setData(prevData =>
        prevData.map(item => {
          if (item.text !== clickedNode.text) {
            return item;
          }
          const newCount = Math.max(0, item.count - 1);
          if (newCount < 1) {
            shouldReload = true;
          }
          return { ...item, count: newCount };
        })
      );
  
      if (shouldReload) {
        location.reload();
      }
    } catch (err) {
      console.error("Failed to decrease count:", err);
      setError("Failed to update item count");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchItems = useCallback(async (subgroups: string | null, classnames: string | null) => {
    setIsLoading(true);
    setError(null);
    
    try {
      let response;
      if(subgroups) {
        response = await fetch(`/api/fetch_items?subgroups=${encodeURIComponent(subgroups)}&only_wish_list=false`);
      } else if(classnames) {
        response = await fetch(`/api/fetch_items?classnames=${encodeURIComponent(classnames)}&only_wish_list=false`);
      } else {
        response = await fetch(`/api/fetch_items?only_wish_list=false`);
      }
      

      interface ApiResponse {
        item_list: [string, string, string, string, number, string[]][];
      }

      interface RawItem {
        0: string;  // ean
        1: string;  // text
        2: string; // subgroups
        3: string;  // classname
        4: number;  // count
        5: string[]; // timestamps
      }

      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const responseData: ApiResponse = await response.json();

      const temp_data: Props[] = responseData.item_list.map((row: RawItem) => ({
        text: row[1],
        subgroups: row[2],
        style: "",
        classname: row[3],
        count: row[4],
        perish_dates: row[5],
        onClickIncrease: increaseItemCount,
        onClickDecrease: decreaseItemCount
      }));
      console.log("element.perish_dates: " + temp_data[0].perish_dates)

      setData(temp_data);
    } 
    catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error));
      console.error("Fetch failed:", error);
    } finally {
      setIsLoading(false);
    }

  }, [increaseItemCount, decreaseItemCount]);

  const fetchSubgroups = useCallback(async (): Promise<string[]> => {
    try {
      const response = await fetch("/api/fetch_subgroups");
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      return data.subgroups;
    } catch (error) {
      console.error("Failed to fetch subgroups:", error);
      throw error;
    }
  }, []);

  const fetchClassnames = useCallback(async (): Promise<string[]> => {
    try {
      const response = await fetch("/api/fetch_classnames");
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      return data.classnames;
    } catch (error) {
      console.error("Failed to fetch classnames:", error);
      throw error;
    }
  }, []);

  const containerComponents = useMemo(() => {
    return data.map((element, idx) => (
      <Container
        key={`${element.text}-${idx}`} 
        text={element.text}
        subgroups={element.subgroups}
        count={element.count}
        classname={element.classname}
        perish_dates={element.perish_dates}
        onClickIncrease={increaseItemCount}
        onClickDecrease={decreaseItemCount}
        style=""
      />
    ));
  }, [data, increaseItemCount, decreaseItemCount]);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // run all initial fetches in parallel
        const [, subgroupsResult, classnamesResult] = await Promise.allSettled([
          fetchItems(null, null),
          fetchSubgroups(),
          fetchClassnames()
        ]);

        if (subgroupsResult.status === 'fulfilled') {
          setSubgroups(subgroupsResult.value);
        } else {
          console.error("Failed to fetch subgroups:", subgroupsResult.reason);
        }

        if (classnamesResult.status === 'fulfilled') {
          setClassnames(classnamesResult.value);
          console.warn("Fetched the following classnames:", classnamesResult.value);
        } else {
          console.error("Failed to fetch classnames:", classnamesResult.reason);
        }

      } catch (error) {
        setError("Failed to load initial data");
        console.error("Initial data load failed:", error);
      }
    };

    loadInitialData();
  }, [fetchClassnames, fetchItems, fetchSubgroups]); 

  // Cleanup effect for media recorder
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  if (isLoading && data.length === 0) {
    return <div className="flex justify-center items-center min-h-screen">Loading...</div>;
  }
//TODO: 
  return (
    
    <div className="flex flex-col justify-start min-h-screen max-w-screen over">
      {error ? (
        <ErrorContainer text={error} />
      ) : (
        <>
        
        { 10000 > phoneWidth ?
          <div className="absolute top-0 left-0 flex items-center justify-center rounded-xl m-4 hover:bg-indigo-950 min-w-10 min-h-10"
             onClick={() => setSidebarIsOpen(!SidebarIsOpen)}>
              {SidebarIsOpen ?(
                <>
                  <div className="absolute top-0 left-0 flex items-center justify-center rounded-xl m-4 hover:bg-gray-700 min-w-10 min-h-10 z-50"
                      onClick={() => setSidebarIsOpen(!SidebarIsOpen)}>
                    <SidebarComp isOpen={SidebarIsOpen} onClose={() => setSidebarIsOpen(false)} />
                    <Bars3Icon className="h-6 w-6 text-white" />
                  </div>
                </>
              ): 
              <Bars3Icon className="h-6 w-6 text-white" />
              }
        </div>
        : 
        <></>
        }

          <div className="flex items-center gap-1 mb-4 ml-4">
            {(width > phoneWidth ?(
            <div>
              <DropdownComp 
                task="subgroups" 
                text="subs" 
                elements={subgroups} 
                onClickElement={fetchItems} 
                onClickReset={fetchItems} 
                style="" 
              />
            </div>
            ):
              <div className='max-w-40 mx-1 bg-amber-500'>
              <DropdownComp 
                task="subgroups" 
                text="subs" 
                elements={subgroups} 
                onClickElement={fetchItems} 
                onClickReset={fetchItems} 
                style="" 
              />
            </div>

            )}

            {(width > phoneWidth ?(
              <div>
                <DropdownComp 
                  task="classnames" 
                  text="class" 
                  elements={classnames} 
                  onClickElement={fetchItems} 
                  onClickReset={fetchItems} 
                  style="" 
                />
              </div>
              ):
              <></>

            )}

            {width > phoneWidth ? 
              <div className='ml-2 flex'>
              
                <StyledButton text='+' onClick={() => navigateScanner(null, 1)} className='mx-2' />
                <StyledButton text='-' onClick={() => navigateScanner(null, -1)} className='mx-2' />
              </div>
                :
                <div className='ml-1 flex'>
                  <StyledButton text='+' onClick={() => navigateScanner(null, 1)} className='mx-1 max-w-8' />
                  <StyledButton text='-' onClick={() => navigateScanner(null, -1)} className='mx-1 max-w-8' />
                
              </div>
            }

            <div className="flex flex-col gap-1 max-w-full">
              <button
                onClick={handleRecording}
                disabled={isLoading}
                className={`px-1 py-1 rounded text-white font-medium text-[clamp(.7rem,.9rem,1rem)] transition-colors flex-shrink-0 ${
                  isRecording ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-blue-500 hover:bg-blue-600'
                } disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto`}
              >
                {isLoading ? 'Processing...' : isRecording ? 'Stop' : 'Record'}
              </button>

              {transcriptionResult && (
                <div className="w-full max-w-[18rem] sm:max-w-xs p-1.5 bg-green-100 border border-green-300 rounded text-xs truncate">
                  <p className="font-semibold text-green-800 text-[0.75rem]">Transcribed:</p>
                  <p className="text-green-700 truncate">{transcriptionResult}</p>
                </div>
              )}
            </div>


            {isLoading && <div className="text-sm text-gray-500">Loading...</div>}
          </div>

          {containerComponents}
        </>
      )}
    </div>
  );
}

export default App;