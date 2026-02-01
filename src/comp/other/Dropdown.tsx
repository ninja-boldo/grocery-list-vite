import { useState, useRef, useEffect, memo } from 'react';

interface Props {
  task: string;
  text: string;
  elements: string[];
  style: string | null;
  className?: string; // allow external sizing
  onClickElement: (subgroups: string | null,  classnames: string | null) => void;
  onClickReset: (subgroups: null, classnames: null) => void;
}

const DropdownComp = ({ task, text, elements, style, className, onClickElement, onClickReset }: Props) => {
  const [isOpen, setIsOpen] = useState(false);
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
    if(task === "subgroups"){
      onClickElement(element, null);
    } else if(task === "classnames"){
      onClickElement(null, element);
    }
    setIsOpen(false);
  };

  const [mainHover, setMainHover] = useState(false);
  const [toggleHover, setToggleHover] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div
      ref={dropdownRef}
      style={{
        position: 'relative',
        display: 'inline-block',
        margin: 0,
        padding: 0,
        background: 'none',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        verticalAlign: 'baseline',
        maxWidth: '6rem' /* constrain default width; override via className/style */
      }}
      className={`${style ?? ''} ${className ?? ''}`}
    >
      <div style={{ display: 'flex', width: '100%' }}>
        {/* Main Button */}
        <button
          onClick={() => onClickReset(null, null)}
          onMouseEnter={() => setMainHover(true)}
          onMouseLeave={() => setMainHover(false)}
          style={{
            all: 'unset',
            boxSizing: 'border-box',
            display: 'inline-block',
            backgroundColor: mainHover ? '#374151' : '#4b5563',
            color: '#ffffff',
            borderTop: '1px solid #6b7280',
            borderBottom: '1px solid #6b7280',
            borderLeft: '1px solid #6b7280',
            borderRight: 'none',
            padding: '6px 8px' /* reduced padding */,
            borderTopLeftRadius: '8px',
            borderBottomLeftRadius: '8px',
            cursor: 'pointer',
            fontSize: '13px' /* slightly smaller */,
            fontWeight: '500',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            lineHeight: '1.2',
            textAlign: 'center',
            userSelect: 'none',
            transition: 'all 0.2s ease',
            outline: 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {isOpen ? "reset" : text}
        </button>

        {/* Dropdown Toggle */}
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
            borderTop: '1px solid #6b7280',
            borderBottom: '1px solid #6b7280',
            borderRight: '1px solid #6b7280',
            borderLeft: '1px solid #374151',
            padding: '6px 8px' /* reduced padding */,
            borderTopRightRadius: '8px',
            borderBottomRightRadius: '8px',
            cursor: 'pointer',
            fontSize: '13px',
            lineHeight: '1.2',
            userSelect: 'none',
            transition: 'all 0.2s ease',
            outline: 'none'
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

      {/* Dropdown Menu */}
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
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.25), 0 4px 10px rgba(0, 0, 0, 0.1)',
            zIndex: 1000,
            minWidth: 'max-content',
            maxWidth: '18rem', /* prevent runaway width */
            overflow: 'hidden',
            backdropFilter: 'blur(8px)'
          }}
        >
          {elements.map((element, index) => (
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
                padding: '8px 10px' /* reduced padding */,
                backgroundColor: hoveredIndex === index ? '#4b5563' : 'transparent',
                color: hoveredIndex === index ? '#ffffff' : '#d1d5db',
                cursor: 'pointer',
                fontSize: '13px',
                lineHeight: '1.2',
                textAlign: 'left',
                userSelect: 'none',
                transition: 'all 0.15s ease',
                outline: 'none',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                borderBottom: index < elements.length - 1 ? '1px solid #4b5563' : 'none'
              }}
            >
              {element}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default memo(DropdownComp);
