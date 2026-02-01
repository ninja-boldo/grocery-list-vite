import React from 'react';

interface VoiceRecorderProps {
  isRecording: boolean;
  isLoading: boolean;
  onRecordClick: () => void;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ 
  isRecording, 
  isLoading, 
  onRecordClick 
}) => {
  return (
    <button
      onClick={onRecordClick}
      disabled={isLoading}
      style={{
        position: 'fixed',
        bottom: '1rem',
        left: '1rem',
        zIndex: 1000,
        backgroundColor: isRecording ? '#ef4444' : '#3b82f6',
        color: 'white',
        border: 'none',
        borderRadius: '50%',
        width: '56px',
        height: '56px',
        cursor: isLoading ? 'not-allowed' : 'pointer',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        transition: 'transform 0.2s, box-shadow 0.2s, background-color 0.3s',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isLoading ? 0.5 : 1,
        animation: isRecording ? 'pulse 1.5s infinite' : 'none'
      }}
      onMouseEnter={(e) => {
        if (!isLoading) {
          e.currentTarget.style.transform = 'scale(1.1)';
          e.currentTarget.style.boxShadow = '0 6px 8px rgba(0, 0, 0, 0.15)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
        e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
      }}
      title={isRecording ? 'Stop Recording' : 'Start Recording'}
    >
      {isLoading ? (
        // Loading spinner
        <svg
          className="animate-spin"
          style={{ width: '24px', height: '24px' }}
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            style={{ opacity: 0.25 }}
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            style={{ opacity: 0.75 }}
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : isRecording ? (
        // Stop icon (square)
        <svg
          style={{ width: '20px', height: '20px' }}
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : (
        // Microphone/chatbot icon
        <svg
          style={{ width: '24px', height: '24px' }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
          />
        </svg>
      )}
      
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }
        
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}} />
    </button>
  );
};

export default VoiceRecorder;
