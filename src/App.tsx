import "./App.css";
import Container, { type ContainerProps } from "./comp/other/Container";
import {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type SetStateAction,
} from "react";
import ErrorContainer from "./comp/utils/ErrorContainer";
import { useNavigate } from "react-router-dom";
import SidebarComp from "./comp/other/Sidebar";
import InfoContainer from "./comp/utils/InfoContainer";
import VoiceRecorder from "./comp/utils/VoiceRecorder";
import { Virtuoso } from "react-virtuoso";
import TopBar from "./comp/other/TopBar";
import { transformItems, PageModes, type ApiResponse } from "./lib/utils";
import { authApiCall, hasStoredJwtToken } from "./lib/authApi";
import AuthPopup from "./comp/other/AuthPopup";

// ============================================================================
// Types
// ============================================================================
export interface Item {
    ean: string;
    text: string | null;
    shortened_name: string | null;
    classname: string | null;
    count: number;
    perish_dates: string[];
    imageUrl: string;
    tags: string[];
}

// ============================================================================
// Constants
// ============================================================================
const PHONE_WIDTH = 500;
const PLACEHOLDER_ITEM_COUNT = 15;
const TRANSCRIPTION_TIMEOUT = 10000;
const RETRY_ATTEMPTS = 3;
const INITIAL_SORT_ORDER = "new-old";
const NEW_ITEMS_PER_FETCH = 20;

// ============================================================================
// Helpers
// ============================================================================
const buildPlaceholderItems = (): Item[] =>
    Array.from({ length: PLACEHOLDER_ITEM_COUNT }, (_, index) => ({
        ean: `loading-${index}`,
        text: "Loading...",
        shortened_name: null,
        classname: null,
        count: 0,
        perish_dates: [],
        imageUrl: "",
        tags: [],
    }));

const isPlaceholderList = (items: Item[]) =>
    items.length > 0 && items[0].ean.startsWith("loading-");

const mergeWithDedup = (previous: Item[], incoming: Item[]): Item[] => {
    const seen = new Set<string>();
    return [...previous, ...incoming].filter((item) => {
        const key = `${item.ean}-${item.text}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

type GroceryItemsHookOptions = {
    setError: Dispatch<SetStateAction<string | null>>;
    isSearchActive: boolean;
    isLoading: boolean;
    setIsLoading: Dispatch<SetStateAction<boolean>>;
    needReauth: boolean;
    onNeedReauth: () => void;
};

type GroceryItemsHookResult = {
    data: Item[];
    setData: Dispatch<SetStateAction<Item[]>>;
    selectedClass: string | null;
    sortOrder: string;
    hasMoreData: boolean;
    noItemsAvailable: boolean;
    filterFetchItems: (
        classFilter: string | null,
        sortOrderFilter?: string,
    ) => Promise<void>;
    resetFilters: () => Promise<void>;
    loadMoreItems: () => void;
};

// ============================================================================
// Main Component
// ============================================================================
function App() {
    const navigate = useNavigate();

    const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
    const [error, setError] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [transcription, setTranscription] = useState<string | null>(null);
    const [isSearchActive, setIsSearchActive] = useState(false);
    const [needReauth, setNeedReauth] = useState(false);

    const isMobile = windowWidth <= PHONE_WIDTH;

    useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        if (!hasStoredJwtToken()) {
            setNeedReauth(true);
        }
    }, []);

    const handleNeedReauth = useCallback(() => {
        setNeedReauth(true);
    }, []);

    const apiCall = useCallback(async <T,>(
        url: string,
        options?: RequestInit,
        retries = RETRY_ATTEMPTS,
        onUnauthorized?: () => void,
    ): Promise<T> =>
        authApiCall<T>(url, options, {
            retries,
            retryDelayMs: 1000,
            onUnauthorized,
        }),
    []);

    function useGroceryItems({
        setError,
        isSearchActive,
        isLoading,
        setIsLoading,
        needReauth,
        onNeedReauth,
    }: GroceryItemsHookOptions): GroceryItemsHookResult {
        const [data, setData] = useState<Item[]>(buildPlaceholderItems());
        const [selectedClass, setSelectedClass] = useState<string | null>(null);
        const [sortOrder, setSortOrder] = useState<string>(INITIAL_SORT_ORDER);
        const [hasMoreData, setHasMoreData] = useState(true);
        const [isInitialLoad, setIsInitialLoad] = useState(true);
        const [noItemsAvailable, setNoItemsAvailable] = useState(false);

        const sortOrderRef = useRef(sortOrder);
        const skipRef = useRef(0);
        const isSearchActiveRef = useRef(isSearchActive);
        const isLoadingRef = useRef(isLoading);
        const hasRealDataRef = useRef(false);

        useEffect(() => {
            sortOrderRef.current = sortOrder;
        }, [sortOrder]);

        useEffect(() => {
            isSearchActiveRef.current = isSearchActive;
        }, [isSearchActive]);

        useEffect(() => {
            isLoadingRef.current = isLoading;
        }, [isLoading]);

        const resetPagination = useCallback(() => {
            skipRef.current = 0;
            hasRealDataRef.current = false;
            setHasMoreData(true);
            setNoItemsAvailable(false);
            setIsInitialLoad(true);
            setData(buildPlaceholderItems());
        }, [setData, setHasMoreData, setNoItemsAvailable, setIsInitialLoad]);

        const appendItems = useCallback(
            (incoming: Item[]) => {
                setData((prev) => {
                    if (isPlaceholderList(prev)) {
                        return incoming;
                    }
                    return mergeWithDedup(prev, incoming);
                });

                if (incoming.length > 0) {
                    hasRealDataRef.current = true;
                    setHasMoreData(true);
                    setNoItemsAvailable(false);
                }
            },
            [setData, setHasMoreData, setNoItemsAvailable],
        );

        const handleEmptyResponse = useCallback(() => {
            setHasMoreData(false);
            if (skipRef.current === 0 && !hasRealDataRef.current) {
                setNoItemsAvailable(true);
                setData([]);
            }
        }, [setHasMoreData, setNoItemsAvailable, setData]);

        const fetchItemsWithParams = useCallback(
            async (sortOrderOverride?: string) => {
                if (needReauth || isLoadingRef.current || isSearchActiveRef.current) {
                    return;
                }

                setIsLoading(true);
                setError(null);

                const sortToUse = sortOrderOverride ?? sortOrderRef.current;
                const params = new URLSearchParams({ only_wish_list: "false" });
                if (sortToUse) {
                    params.set("sortOrder", sortToUse);
                }
                params.set("skip", skipRef.current.toString());
                params.set("limit", NEW_ITEMS_PER_FETCH.toString());
                params.set("userId", "1");

                try {
                    const response = await apiCall<ApiResponse>(
                        `/api/fetch_items?${params}`,
                        undefined,
                        RETRY_ATTEMPTS,
                        onNeedReauth,
                    );

                    if (!response.items.length) {
                        handleEmptyResponse();
                        return;
                    }

                    skipRef.current += response.items.length;
                    appendItems(transformItems(response));
                } catch (err) {
                    const errorMessage =
                        err instanceof Error ? err.message : "Failed to fetch items";
                    setError(errorMessage);
                } finally {
                    setIsLoading(false);
                    setIsInitialLoad(false);
                }
            },
            [
                appendItems,
                handleEmptyResponse,
                needReauth,
                onNeedReauth,
                setError,
                setIsLoading,
            ],
        );

        const filterFetchItems = useCallback(
            async (classFilter: string | null, sortOrderFilter?: string) => {
                if (classFilter !== null) {
                    setSelectedClass(classFilter);
                }

                if (!sortOrderFilter) {
                    return;
                }

                setSortOrder(sortOrderFilter);
                resetPagination();
                await fetchItemsWithParams(sortOrderFilter);
            },
            [fetchItemsWithParams, resetPagination, setSelectedClass, setSortOrder],
        );

        const resetFilters = useCallback(async () => {
            setSelectedClass(null);
            setSortOrder(INITIAL_SORT_ORDER);
            resetPagination();
            await fetchItemsWithParams(INITIAL_SORT_ORDER);
        }, [fetchItemsWithParams, resetPagination, setSelectedClass, setSortOrder]);

        const loadMoreItems = useCallback(() => {
            if (
                !isInitialLoad &&
                hasMoreData &&
                !isLoadingRef.current &&
                !isSearchActiveRef.current
            ) {
                void fetchItemsWithParams();
            }
        }, [fetchItemsWithParams, hasMoreData, isInitialLoad]);

        useEffect(() => {
            void fetchItemsWithParams();
        }, [fetchItemsWithParams]);

        return {
            data,
            setData,
            selectedClass,
            sortOrder,
            hasMoreData,
            noItemsAvailable,
            filterFetchItems,
            resetFilters,
            loadMoreItems,
        };
    }

    const {
        data,
        setData,
        selectedClass,
        sortOrder,
        hasMoreData,
        noItemsAvailable,
        filterFetchItems,
        resetFilters,
        loadMoreItems,
    } = useGroceryItems({
        setError,
        isSearchActive,
        isLoading,
        setIsLoading,
        needReauth,
        onNeedReauth: handleNeedReauth,
    });

    useEffect(() => {
        if (needReauth) {
            setError("Authentication required. Please sign in again.");
        }
    }, [needReauth]);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const recordedChunksRef = useRef<Blob[]>([]);
    const transcriptionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (mediaRecorderRef.current?.state === "recording") {
                mediaRecorderRef.current.stop();
            }
            if (transcriptionTimer.current) clearTimeout(transcriptionTimer.current);
        };
    }, []);

    const availableClasses = useMemo(() => {
        const result = new Set<string>();
        data.forEach((item) => {
            if (item.ean.startsWith("loading-")) return;
            item.tags.forEach((tag) => {
                const cleaned = tag?.trim();
                if (cleaned) result.add(cleaned);
            });
        });
        return Array.from(result).sort((a, b) => a.localeCompare(b));
    }, [data]);

    const visibleData = useMemo(() => {
        if (!selectedClass) return data;
        return data.filter(
            (item) =>
                item.ean.startsWith("loading-") ||
                item.tags.some((tag) => tag === selectedClass),
        );
    }, [data, selectedClass]);

    // FIX: replaced raw fetch with apiCall so the Authorization header is
    // guaranteed to be attached. The raw fetch was duplicating header-building
    // logic and silently sending no auth header when localStorage was null.
    // Also added Content-Type: application/json which was missing entirely.
    const updateItemCount = useCallback(
        async (item: ContainerProps, delta: number) => {
            if (!item.text) return;

            const newCount = item.count + delta;

            setData((prev) =>
                prev.map((i) =>
                    i.text === item.text ? { ...i, count: Math.max(0, newCount) } : i,
                ),
            );

            try {
                await apiCall(
                    "/api/add_ean_to_list/",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            ean: item.ean,
                            item_name: item.text,
                            count: delta,
                            wish_list: "false",
                        }),
                    },
                    1,
                    handleNeedReauth,
                );

                if (newCount <= 0) {
                    setTimeout(() => window.location.reload(), 100);
                }
            } catch (err) {
                setError("Failed to update item");
                setData((prev) =>
                    prev.map((i) =>
                        i.text === item.text ? { ...i, count: item.count } : i,
                    ),
                );
                console.error("Error updating item:", err);
            }
        },
        [apiCall, handleNeedReauth, setData, setError],
    );

    const increaseItem = useCallback(
        (item: ContainerProps) => updateItemCount(item, 1),
        [updateItemCount],
    );
    const decreaseItem = useCallback(
        (item: ContainerProps) => updateItemCount(item, -1),
        [updateItemCount],
    );

    const startRecording = useCallback(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, sampleRate: 16000 },
        });

        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : "audio/webm";

        const recorder = new MediaRecorder(stream, { mimeType });
        recordedChunksRef.current = [];

        recorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordedChunksRef.current.push(event.data);
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
                const audioBlob = new Blob(recordedChunksRef.current, {
                    type: "audio/webm",
                });
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
                return;
            }

            setIsLoading(true);

            const blob = await stopRecording();
            if (blob.size === 0) {
                setError("No audio recorded");
                return;
            }

            const formData = new FormData();
            formData.append(
                "file",
                new File([blob], "recording.webm", { type: blob.type }),
            );

            const params = new URLSearchParams({ only_wish_list: "false" });
            params.set("ListTypesInput", "item_list");

            const result = await apiCall<{ transcribed_text: string }>(
                `/api/transcribe?${params}`,
                {
                    method: "POST",
                    body: formData,
                },
                3,
                handleNeedReauth,
            );

            setTranscription(result.transcribed_text);

            if (transcriptionTimer.current) clearTimeout(transcriptionTimer.current);
            transcriptionTimer.current = setTimeout(
                () => setTranscription(null),
                TRANSCRIPTION_TIMEOUT,
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : "Recording failed");
            setIsRecording(false);
        } finally {
            setIsLoading(false);
        }
    }, [apiCall, handleNeedReauth, isRecording, startRecording, stopRecording]);

    const navigateScanner = useCallback(
        (count: number) => {
            navigate(`/scanner?text=&count=${encodeURIComponent(count)}`);
        },
        [navigate],
    );

    const displayError = (() => {
        if (!error) return null;

        const normalized = error.toLowerCase();
        const excludedFragments = [
            "there are no items in the database",
            "http 401",
            "authentication required. please sign in again.",
        ];

        const isExcluded = excludedFragments.some((fragment) =>
            normalized.includes(fragment),
        );

        return isExcluded ? null : error;
    })();

    if (isLoading && data.length === 0) {
        return (
            <div className="flex justify-center items-center min-h-screen">
                <div className="text-cyan-400 text-lg">Loading...</div>
            </div>
        );
    }

    return (
        <div className="h-screen ">
            {needReauth && (
                <AuthPopup
                    onAuthenticated={() => {
                        setNeedReauth(false);
                        setError(null);
                    }}
                />
            )}
            <SidebarComp isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} setNeedReauth={setNeedReauth} />
            {displayError ? (
                <ErrorContainer text={displayError} />
            ) : (
                <div className="h-screen">
                    <TopBar
                        sidebarOpen={sidebarOpen}
                        onSidebarToggle={() => setSidebarOpen(!sidebarOpen)}
                        classNames={availableClasses}
                        selectedClass={selectedClass}
                        onFilter={filterFetchItems}
                        onReset={resetFilters}
                        onScanIncrease={() => navigateScanner(1)}
                        onScanDecrease={() => navigateScanner(-1)}
                        items={data}
                        setItems={setData}
                        currentSortOrder={sortOrder}
                        mode={PageModes.HomePage}
                        onSearchStateChange={setIsSearchActive}
                    />

                    <div className=" flex-1 p-3 sm:p-4 md:p-6">
                        <div className="max-w-4xl mx-auto ">
                            {noItemsAvailable ? (
                                <InfoContainer
                                    text={
                                        "No items available in the database.\nSo perhaps add one."
                                    }
                                />
                            ) : (
                                <Virtuoso
                                    style={{ height: "85vh" }}
                                    data={visibleData}
                                    endReached={() => {
                                        if (hasMoreData && !isLoading && !isSearchActive) {
                                            loadMoreItems();
                                        }
                                    }}
                                    itemContent={(idx, item) => (
                                        <Container
                                            key={idx}
                                            text={item.text}
                                            shortened_name={item.shortened_name}
                                            count={item.count}
                                            classname={item.classname}
                                            perish_dates={item.perish_dates}
                                            imageUrl={item.imageUrl}
                                            ean={item.ean}
                                            onClickIncrease={increaseItem}
                                            onClickDecrease={decreaseItem}
                                            tags={item.tags}
                                            isWishedNumber={null}
                                            style="m-2"
                                        />
                                    )}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}
            <div className="flex flex-row">
                <VoiceRecorder
                    isRecording={isRecording}
                    isLoading={isLoading}
                    onRecordClick={handleRecording}
                />

                {transcription && (
                    <div className="hidden sm:block max-w-xs p-2 bg-green-100 border border-green-300 rounded text-xs">
                        <p className="text-green-700 truncate">{transcription}</p>
                    </div>
                )}

                {transcription && isMobile && (
                    <div className="mx-3 mt-2 p-2 bg-green-100 border border-green-300 rounded text-xs">
                        <p className="font-semibold text-green-800">Transcribed:</p>
                        <p className="text-green-700">{transcription}</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default memo(App);