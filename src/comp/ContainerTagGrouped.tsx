import { memo, useEffect, useRef, useState } from "react";
import GroupHeader from "./grouped/GroupHeader";
import TagBadge from "./grouped/TagBadge";
import SubItemCard from "./grouped/SubItemCard";

interface CompositeItems {
  name: string;
  count: number;
}

interface Props {
  tags: string;
  name: string;
  subItems: CompositeItems[];
}

const ContainerTagGrouped = ({ tags, name, subItems }: Props) => {
  const [open, setOpen] = useState(false);
  const divRef = useRef<HTMLDivElement | null>(null);

  // Parse tags string to array
  const parseTagsArray = (tagString: string): string[] => {
    if (!tagString) return [];
    try {
      const parsed = JSON.parse(tagString);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Fallback: split by comma
      return tagString.split(',').map(t => t.trim()).filter(Boolean);
    }
  };

  const tagsArray = parseTagsArray(tags);
  
  // Calculate total count from subItems
  const totalCount = subItems.reduce((sum, item) => sum + item.count, 0);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (divRef.current && !divRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, []);

  return (
    <div className="max-w-3xl mt-4 mb-4 px-4 w-full" ref={divRef}>
      {/* Header */}
      <GroupHeader 
        name={name}
        totalCount={totalCount}
        isOpen={open}
        onClick={() => setOpen(!open)}
      />

      {/* Dropdown content */}
      <div 
        className={`transition-all duration-500 ease-out ${open ? 'max-h-200 opacity-100' : 'max-h-0 opacity-0'}`}
        style={{ overflow: 'hidden' }}
      >
        <div className={`mt-3 transform transition-all duration-400 ${open ? 'translate-y-0' : '-translate-y-4'}`}>
          <div className="bg-linear-to-r from-slate-900/80 to-slate-800/80 backdrop-blur-md rounded-xl border border-cyan-500/20 shadow-lg shadow-cyan-500/10 mx-2 p-4">
            
            {/* Tags section */}
            {tagsArray.length > 0 && (
              <div className="mb-4">
                <div className="flex flex-wrap gap-2">
                  {tagsArray.map((tag, index) => (
                    <TagBadge 
                      key={index} 
                      tag={tag} 
                      index={index}
                      isOpen={open}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* SubItems section */}
            {subItems.length > 0 && (
              <div className="space-y-2.5">
                {subItems.map((item, index) => (
                  <SubItemCard
                    key={index}
                    name={item.name}
                    count={item.count}
                    index={index}
                    isOpen={open}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {subItems.length === 0 && (
              <div className="flex items-center gap-2 p-3 bg-slate-800/40 rounded-lg border border-slate-700/30">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-400/60"></div>
                <p className="text-slate-400 text-sm">No items in this group</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(ContainerTagGrouped);
