import { memo, useState, useRef, useEffect, useCallback } from "react";
import type { Item } from "../App";

interface Props {
  placeholder: string;
  itemsToRender: Item[];
  setItemsToRender: (items: Item[]) => void;
}

const SearchBar = ({ placeholder, itemsToRender, setItemsToRender }: Props) => {
  const [collapsed, setCollapsed] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const allItemsRef = useRef<Item[]>(itemsToRender);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchBarRef = useRef<HTMLDivElement>(null);

  const handleSearch = () => {
    if (!searchTerm.trim()) {
      setItemsToRender(allItemsRef.current);
      return;
    }

    const matchedItems = allItemsRef.current.filter((item) => 
      item?.text?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setItemsToRender(matchedItems);
  };

  const handleClose = useCallback(() => {
    setSearchTerm("");
    setCollapsed(true);
    setItemsToRender(allItemsRef.current);
  }, [setItemsToRender]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
    if (e.key === "Escape") handleClose();
  };

  // Detect clicks outside the search bar
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchBarRef.current && !searchBarRef.current.contains(event.target as Node)) {
        setSearchTerm("");
        setItemsToRender(allItemsRef.current);
        handleClose();
      }
    };

    if (!collapsed) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [collapsed, handleClose]);

return collapsed ? (
  <button 
    onClick={() => setCollapsed(false)} 
    className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow-md transition-all duration-200 flex items-center gap-2 font-medium shrink-0"
  >
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  </button>
) : (
  /* This wrapper now positions itself absolutely relative to the sticky <header> */
  <div 
    ref={searchBarRef}
    className="absolute inset-0 z-[60] flex flex-row gap-2 items-center bg-slate-900 px-3 sm:px-6 rounded-2xl animate-in fade-in zoom-in duration-200"
  >
    <div className="relative flex-1 flex items-center gap-2">
      <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        className="w-full py-2 bg-transparent text-white text-lg focus:outline-none"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onKeyDown={handleKeyPress}
        placeholder={placeholder}
        type="search"
        autoFocus
      />
    </div>

    {/* Search and Close buttons */}
    <div className="flex items-center justify-center gap-3 shrink-0">
      <button 
        onClick={handleSearch} 
        /* flex items-center justify-center is what handles the centering */
        className="flex items-center justify-center w-10 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-all active:scale-95 shadow-sm"
      >
       {/*<svg className="w-19 h-19" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>*/}
        🔎
      </button>
      
      <button 
        onClick={handleClose}
        className="flex items-center justify-center w-10 h-10 text-2xl font-bold text-gray-400 hover:text-white hover:bg-slate-800/50 rounded-md transition-all leading-none"
      >
        ×
      </button>
    </div>
  </div>
);
};

export default memo(SearchBar);
