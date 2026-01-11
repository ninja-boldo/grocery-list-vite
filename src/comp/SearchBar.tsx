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
      className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow-md transition-all duration-200 flex items-center gap-2 font-medium"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      Search
    </button>
  ) : (
    <div 
      ref={searchBarRef}
      className="flex flex-row gap-2 items-center bg-gray-50/80 backdrop-blur-sm rounded-lg shadow-md p-2 border border-gray-300"
    >
      <div className="relative flex-1">
        <svg className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          className="w-full pl-10 pr-10 py-2 border border-gray-300 bg-white text-black rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder={placeholder}
          type="search"
          autoFocus
        />
        {searchTerm && (
          <button
            onClick={() => {
              setSearchTerm("");
              setItemsToRender(allItemsRef.current);
            }}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      <button 
        onClick={handleSearch} 
        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors font-medium"
      >
        Search
      </button>
      
    </div>
  );
};

export default memo(SearchBar);
