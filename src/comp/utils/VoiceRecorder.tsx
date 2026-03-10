import React from 'react';

interface VoiceRecorderProps {
  isRecording: boolean;
  isLoading: boolean;
  onRecordClick: () => void;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  isRecording,
  isLoading,
  onRecordClick,
}) => {
  return (
    <button
      onClick={onRecordClick}
      disabled={isLoading}
      style={{
        all: 'unset',
        boxSizing: 'border-box',
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '3em',
        height: '3em',
        fontSize: 12,
        borderRadius: 8,
        backgroundColor: '#161b22',
        color: isRecording ? '#f87171' : '#4d5566',
        border: `1px solid ${isRecording ? '#f8717150' : '#21262d'}`,
        cursor: isLoading ? 'not-allowed' : 'pointer',
        opacity: isLoading ? 0.4 : 1,
        transition: 'all 0.15s',
        animation: isRecording ? 'vr-ring 2s ease-in-out infinite' : 'none',
      }}
      onMouseEnter={(e) => {
        if (!isLoading) {
          e.currentTarget.style.borderColor = isRecording ? '#f8717180' : '#0d948850';
          e.currentTarget.style.color = isRecording ? '#fca5a5' : '#5eead4';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = isRecording ? '#f8717150' : '#21262d';
        e.currentTarget.style.color = isRecording ? '#f87171' : '#4d5566';
      }}
      title={isRecording ? 'Stop recording' : 'Start recording'}
    >
      {isLoading ? (
        <svg
          style={{ width: '16px', height: '16px', animation: 'vr-spin 1s linear infinite' }}
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle style={{ opacity: 0.2 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path style={{ opacity: 0.8 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : isRecording ? (
        <svg style={{ width: '14px', height: '14px' }} fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : (
        <svg style={{ width: '16px', height: '16px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes vr-ring {
          0%, 100% { box-shadow: 0 0 0 2px #f8717130; }
          50%       { box-shadow: 0 0 0 4px #f8717140; }
        }
        @keyframes vr-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}} />
    </button>
  );
};

export default VoiceRecorder;
