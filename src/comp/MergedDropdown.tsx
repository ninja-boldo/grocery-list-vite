import { useState, useRef, useEffect } from 'react';

interface Props {
  subgroups: string[];
  sortOrder: string[];
  onClickElement: (subgroup: string | null, sortOrder: string | null) => void;
  onClickReset: (subgroup: null, sortOrder: null) => void;
}

const MergedDropdown = ({ subgroups, sortOrder, onClickElement, onClickReset }: Props) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'subs' | 'sortOrder'>('subs');
  const [mainHover, setMainHover] = useState(false);
  const [toggleHover, setToggleHover] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleElementClick = (element: string) => {
    if (activeTab === 'subs') {
      onClickElement(element, null, );
    } else {
      onClickElement(null, element);
    }
    setIsOpen(false);
  };

  const currentElements = activeTab === 'subs' ? subgroups : sortOrder;

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <div style={{ display: 'flex' }}>
        <button
          onClick={() => onClickReset(null, null)}
          onMouseEnter={() => setMainHover(true)}
          onMouseLeave={() => setMainHover(false)}
          style={{
            all: 'unset',
            boxSizing: 'border-box',
            backgroundColor: mainHover ? '#374151' : '#4b5563',
            color: '#ffffff',
            border: '1px solid #6b7280',
            borderRight: 'none',
            padding: '6px 8px',
            borderTopLeftRadius: '8px',
            borderBottomLeftRadius: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '500',
            transition: 'all 0.2s ease',
            whiteSpace: 'nowrap'
          }}
        >
          {isOpen ? "reset" : "filter"}
        </button>

        <button
          onClick={() => setIsOpen(!isOpen)}
          onMouseEnter={() => setToggleHover(true)}
          onMouseLeave={() => setToggleHover(false)}
          style={{
            all: 'unset',
            boxSizing: 'border-box',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: toggleHover ? '#374151' : '#4b5563',
            color: '#ffffff',
            border: '1px solid #6b7280',
            borderLeft: '1px solid #374151',
            padding: '6px 8px',
            borderTopRightRadius: '8px',
            borderBottomRightRadius: '8px',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
        >
          <svg 
            width="14" 
            height="14" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2"
            style={{
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease'
            }}
          >
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
      </div>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '0',
            marginTop: '4px',
            backgroundColor: '#374151',
            border: '1px solid #4b5563',
            borderRadius: '8px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.25)',
            zIndex: 1000,
            minWidth: '180px',
            overflow: 'hidden'
          }}
        >
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #4b5563' }}>
            <button
              onClick={() => setActiveTab('subs')}
              style={{
                all: 'unset',
                boxSizing: 'border-box',
                flex: 1,
                padding: '8px',
                textAlign: 'center',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500',
                color: activeTab === 'subs' ? '#ffffff' : '#9ca3af',
                backgroundColor: activeTab === 'subs' ? '#4b5563' : 'transparent',
                transition: 'all 0.15s ease'
              }}
            >
              subs
            </button>
            <button
              onClick={() => setActiveTab('sortOrder')}
              style={{
                all: 'unset',
                boxSizing: 'border-box',
                flex: 1,
                padding: '8px',
                textAlign: 'center',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: '500',
                color: activeTab === 'sortOrder' ? '#ffffff' : '#9ca3af',
                backgroundColor: activeTab === 'sortOrder' ? '#4b5563' : 'transparent',
                transition: 'all 0.15s ease'
              }}
            >
              sortOrder
            </button>
          </div>

          {/* Items */}
          <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {currentElements.map((element, index) => (
              <button
                key={index}
                onClick={() => handleElementClick(element)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  display: 'block',
                  width: '100%',
                  padding: '8px 10px',
                  backgroundColor: hoveredIndex === index ? '#4b5563' : 'transparent',
                  color: hoveredIndex === index ? '#ffffff' : '#d1d5db',
                  cursor: 'pointer',
                  fontSize: '13px',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  borderBottom: index < currentElements.length - 1 ? '1px solid #4b5563' : 'none'
                }}
              >
                {element}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MergedDropdown;