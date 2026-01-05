import React, { useState } from 'react';

interface AttributionNoticeProps {
  compact?: boolean;
  floating?: boolean;
}

const AttributionNotice: React.FC<AttributionNoticeProps> = ({ compact = false, floating = false }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (floating) {
    return (
      <div style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        zIndex: 1000,
      }}>
        {/* Collapsed Button */}
        {!isExpanded && (
          <button
            onClick={() => setIsExpanded(true)}
            style={{
              backgroundColor: '#ff8000',
              color: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '48px',
              height: '48px',
              fontSize: '1.25rem',
              cursor: 'pointer',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
              transition: 'transform 0.2s, box-shadow 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.boxShadow = '0 6px 8px rgba(0, 0, 0, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
            }}
            title="Data Attribution"
          >
            ⓘ
          </button>
        )}

        {/* Expanded Panel */}
        {isExpanded && (
          <div style={{
            backgroundColor: '#fff',
            border: '1px solid #e0e0e0',
            borderRadius: '12px',
            padding: '1.25rem',
            maxWidth: '320px',
            fontSize: '0.85rem',
            lineHeight: '1.5',
            boxShadow: '0 8px 16px rgba(0, 0, 0, 0.15)',
            animation: 'slideIn 0.2s ease-out'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#333', fontWeight: '600' }}>
                Data Attribution
              </h3>
              <button
                onClick={() => setIsExpanded(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#999',
                  padding: 0,
                  lineHeight: 1
                }}
                title="Close"
              >
                ×
              </button>
            </div>
            <p style={{ margin: '0.5rem 0', color: '#555' }}>
              This app uses data from{' '}
              <a
                href="https://world.openfoodfacts.org"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#ff8000', textDecoration: 'underline' }}
              >
                Open Food Facts
              </a>:
            </p>
            <ul style={{ margin: '0.5rem 0 0.75rem 1.25rem', color: '#555', paddingLeft: 0 }}>
              <li>Product database dump</li>
              <li>Open Food Facts API</li>
            </ul>
            <p style={{ margin: '0.5rem 0', color: '#555', fontSize: '0.8rem' }}>
              Licensed under{' '}
              <a
                href="https://opendatacommons.org/licenses/odbl/1.0/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#ff8000', textDecoration: 'underline' }}
              >
                ODbL
              </a>
              {' '}and{' '}
              <a
                href="https://opendatacommons.org/licenses/dbcl/1.0/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#ff8000', textDecoration: 'underline' }}
              >
                DbCL
              </a>
              .
            </p>
            <a
              href="https://world.openfoodfacts.org/terms-of-use"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                marginTop: '0.5rem',
                color: '#ff8000',
                textDecoration: 'underline',
                fontSize: '0.8rem'
              }}
            >
              View Terms of Use →
            </a>
          </div>
        )}

        <style>{`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </div>
    );
  }

  if (compact) {
    return (
      <div style={{
        fontSize: '0.75rem',
        color: '#666',
        padding: '0.5rem',
        textAlign: 'center',
        borderTop: '1px solid #e0e0e0'
      }}>
        Product data provided by{' '}
        <a
          href="https://world.openfoodfacts.org"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#ff8000', textDecoration: 'none' }}
        >
          Open Food Facts
        </a>
        {' '}under{' '}
        <a
          href="https://opendatacommons.org/licenses/odbl/1.0/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#ff8000', textDecoration: 'none' }}
        >
          ODbL
        </a>
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: '#f9f9f9',
      border: '1px solid #e0e0e0',
      borderRadius: '8px',
      padding: '1.5rem',
      margin: '1rem 0',
      fontSize: '0.9rem',
      lineHeight: '1.6'
    }}>
      <h3 style={{ marginTop: 0, fontSize: '1.1rem', color: '#333' }}>
        Data Attribution
      </h3>
      <p style={{ margin: '0.5rem 0', color: '#555' }}>
        This application uses product data and services provided by{' '}
        <a
          href="https://world.openfoodfacts.org"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#ff8000', textDecoration: 'underline' }}
        >
          Open Food Facts
        </a>
        , including:
      </p>
      <ul style={{ margin: '0.5rem 0 1rem 1.5rem', color: '#555' }}>
        <li>Product database dump</li>
        <li>Open Food Facts API</li>
      </ul>
      <p style={{ margin: '0.5rem 0', color: '#555' }}>
        The Open Food Facts database is available under the{' '}
        <a
          href="https://opendatacommons.org/licenses/odbl/1.0/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#ff8000', textDecoration: 'underline' }}
        >
          Open Database License (ODbL)
        </a>
        , and individual contents are available under the{' '}
        <a
          href="https://opendatacommons.org/licenses/dbcl/1.0/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#ff8000', textDecoration: 'underline' }}
        >
          Database Contents License (DbCL)
        </a>
        .
      </p>
      <p style={{ margin: '0.5rem 0 0', color: '#555' }}>
        For complete terms of use and licensing information, please refer to{' '}
        <a
          href="https://world.openfoodfacts.org/terms-of-use"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#ff8000', textDecoration: 'underline' }}
        >
          Open Food Facts Terms of Use
        </a>
        .
      </p>
    </div>
  );
};

export default AttributionNotice;
