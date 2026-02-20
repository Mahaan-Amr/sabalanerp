'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { FaEraser, FaCheck, FaTimes, FaUndo } from 'react-icons/fa';

interface DigitalSignatureProps {
  onSave: (signatureData: string) => void;
  onCancel: () => void;
  width?: number;
  height?: number;
  className?: string;
}

export default function DigitalSignature({ 
  onSave, 
  onCancel, 
  width = 400, 
  height = 200,
  className = ''
}: DigitalSignatureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureHistory, setSignatureHistory] = useState<ImageData[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = width;
    canvas.height = height;

    // Set drawing styles
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = 'transparent';

    // Clear canvas
    ctx.clearRect(0, 0, width, height);
  }, [width, height]);

  // Start drawing
  const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let x: number, y: number;

    if ('touches' in e) {
      // Touch event
      x = (e.touches[0].clientX - rect.left) * scaleX;
      y = (e.touches[0].clientY - rect.top) * scaleY;
    } else {
      // Mouse event
      x = (e.clientX - rect.left) * scaleX;
      y = (e.clientY - rect.top) * scaleY;
    }

    ctx.beginPath();
    ctx.moveTo(x, y);
  }, []);

  // Draw
  const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let x: number, y: number;

    if ('touches' in e) {
      // Touch event
      x = (e.touches[0].clientX - rect.left) * scaleX;
      y = (e.touches[0].clientY - rect.top) * scaleY;
    } else {
      // Mouse event
      x = (e.clientX - rect.left) * scaleX;
      y = (e.clientY - rect.top) * scaleY;
    }

    ctx.lineTo(x, y);
    ctx.stroke();
  }, [isDrawing]);

  // Stop drawing
  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    
    setIsDrawing(false);
    setHasSignature(true);
    
    // Save current state to history
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const newHistory = signatureHistory.slice(0, currentStep + 1);
    newHistory.push(imageData);
    setSignatureHistory(newHistory);
    setCurrentStep(newHistory.length - 1);
  }, [isDrawing, signatureHistory, currentStep]);

  // Clear signature
  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    setSignatureHistory([]);
    setCurrentStep(-1);
  }, []);

  // Undo last stroke
  const undoSignature = useCallback(() => {
    if (currentStep < 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (currentStep === 0) {
      // Clear everything
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setHasSignature(false);
    } else {
      // Restore previous state
      const prevImageData = signatureHistory[currentStep - 1];
      ctx.putImageData(prevImageData, 0, 0);
    }

    setCurrentStep(currentStep - 1);
  }, [currentStep, signatureHistory]);

  // Save signature
  const saveSignature = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const signatureData = canvas.toDataURL('image/png');
    onSave(signatureData);
  }, [onSave]);

  // Prevent scrolling on touch devices
  const preventScroll = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div className={`glass-liquid-card p-6 ${className}`}>
      <div className="text-center mb-4">
        <h3 className="text-xl font-bold text-primary mb-2">??? ??</h3>
        <p className="text-secondary text-sm">??? ??? ?? ? ? ?? ?? ?? ??</p>
      </div>

      {/* Signature Canvas */}
      <div className="relative border-2 border-dashed border-gray-600 rounded-lg bg-gray-800/50 mb-4">
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-crosshair touch-none"
          style={{ width: `${width}px`, height: `${height}px` }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={(e) => {
            preventScroll(e);
            startDrawing(e);
          }}
          onTouchMove={(e) => {
            preventScroll(e);
            draw(e);
          }}
          onTouchEnd={(e) => {
            preventScroll(e);
            stopDrawing();
          }}
        />
        
        {/* Signature Placeholder */}
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-500 text-sm">??? ?? ? ??? ?? ??</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex justify-center space-x-4 space-x-reverse mb-4">
        <button
          onClick={undoSignature}
          disabled={currentStep < 0}
          className="glass-liquid-btn p-2 disabled:opacity-50 disabled:cursor-not-allowed"
          title="???"
        >
          <FaUndo className="h-4 w-4" />
        </button>
        
        <button
          onClick={clearSignature}
          className="glass-liquid-btn p-2"
          title="?? ??"
        >
          <FaEraser className="h-4 w-4" />
        </button>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-center space-x-4 space-x-reverse">
        <button
          onClick={onCancel}
          className="glass-liquid-btn px-6 py-2"
        >
          <FaTimes className="ml-2 h-4 w-4" />
          ???
        </button>
        
        <button
          onClick={saveSignature}
          disabled={!hasSignature}
          className="glass-liquid-btn-primary px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FaCheck className="ml-2 h-4 w-4" />
          ??? ??
        </button>
      </div>

      {/* Instructions */}
      <div className="mt-4 text-center">
        <p className="text-xs text-gray-500">
          ?? ??? ??? ? ??? ? ?? ?? ??
        </p>
      </div>
    </div>
  );
}

