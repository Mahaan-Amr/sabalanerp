'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { formatDisplayNumber } from '@/lib/numberFormat';
import {
  lengthToMeters,
  widthToCm,
  metersToCm,
  calculateAspectRatio,
  realToCanvasRect,
  getRemainingStoneRect,
  isPointInRect,
  type CanvasRect
} from '@/lib/canvasUtils';

// Types and Interfaces
interface RemainingStone {
  id: string;
  width: number; // عرض باقی‌مانده (in cm)
  length: number; // Ø·Ùˆل باقی‌مانده (in meters)
  squareMeters: number; // متر مربع باقی‌مانده
  isAvailable: boolean;
  sourceCutId: string;
  position?: { // موقعیت در سنگ اصلی (برای نمایش در canvas) - فقط برای پارتیشن‌ها
    startWidth: number; // Ø´Ø±Ùˆع عرض (in cm)
    startLength: number; // Ø´Ø±Ùˆع Ø·Ùˆل (in meters)
  };
}

interface SubService {
  id: string;
  code: string;
  name?: string;
  namePersian: string;
  description?: string;
  pricePerMeter: number;
  calculationBase: 'length' | 'squareMeters';
  isActive: boolean;
}

interface AppliedSubService {
  id: string;
  subServiceId: string;
  subService: SubService;
  meter: number; // مقدار استفاده شده (Ø·Ùˆل یا متر مربع)
  cost: number;
  calculationBase: 'length' | 'squareMeters';
}

interface ClickableArea {
  x: number;
  y: number;
  width: number;
  height: number;
  remainingStone: RemainingStone;
  rect: CanvasRect; // Store the full rectangle for reference
}

interface StoneCanvasProps {
  // Original stone dimensions
  originalLength: number | string; // Ø·Ùˆل اصلی (in meters) - can be string from database
  originalWidth: number | string; // عرض اصلی (in cm) - can be string from database
  lengthUnit: 'cm' | 'm';
  widthUnit: 'cm' | 'm';
  
  // Used portions (for remaining stone usage)
  usedLength?: number; // طول استفاده شده (in meters) - from totalUsedRemainingLength
  usedWidth?: number; // عرض استفاده شده (in cm) - from totalUsedRemainingWidth
  
  // Product dimensions (for calculating initial cut visualization)
  productLength?: number; // طول محصول (in meters) - for calculating initial cut
  productWidth?: number; // عرض محصول (in cm) - for calculating initial cut
  productLengthUnit?: 'cm' | 'm'; // واحد طول محصول
  productWidthUnit?: 'cm' | 'm'; // واحد عرض محصول
  isCut?: boolean; // آیا سنگ برش خورده است - if true, show initial cut visualization
  
  // Remaining pieces
  remainingStones?: RemainingStone[];
  usedRemainingStones?: RemainingStone[]; // Used pieces (partitions) - for drawing used overlays
  
  // Sub-service usage (Phase 3)
  usedLengthForSubServices?: number; // طول استفاده شده برای ابزار (in meters)
  usedSquareMetersForSubServices?: number; // متر مربع استفاده شده برای ابزار
  appliedSubServices?: AppliedSubService[]; // ابزارهای اعمال شده برای نمایش overlay
  
  // Interaction callbacks
  onPieceClick?: (piece: RemainingStone) => void;
  interactive?: boolean; // Enable click/hover interactions
  
  // Layer information (for enhanced labeling)
  isLayerFromRemaining?: boolean; // Whether this layer is cut from remaining stones
  
  // Styling
  className?: string;
  width?: number | string; // Canvas width (default: responsive)
  height?: number | string; // Canvas height (default: 140px)
}

const StoneCanvas: React.FC<StoneCanvasProps> = ({
  originalLength,
  originalWidth,
  lengthUnit,
  widthUnit,
  usedLength = 0,
  usedWidth = 0,
  productLength,
  productWidth,
  productLengthUnit = 'm',
  productWidthUnit = 'cm',
  isCut = false,
  remainingStones = [],
  usedRemainingStones = [], // Used pieces (partitions) from remaining stones
  usedLengthForSubServices = 0,
  usedSquareMetersForSubServices = 0,
  appliedSubServices = [],
  onPieceClick,
  interactive = false,
  isLayerFromRemaining = false, // Whether this layer is cut from remaining stones
  className = '',
  width,
  height = 140
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 280, height: 140 });
  const [hoveredArea, setHoveredArea] = useState<ClickableArea | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const clickableAreasRef = useRef<ClickableArea[]>([]); // Store all clickable areas for hit detection
  const debugLogged = useRef(false);
  
  // === Phase 3, Task 3: Animation state ===
  const [animationProgress, setAnimationProgress] = useState(1); // 0 to 1 for fade-in/out
  const animationStartTimeRef = useRef<number | null>(null);
  const previousRemainingCountRef = useRef<number>(0);
  
  // === Phase 4: Mobile & Accessibility state ===
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [focusedPieceIndex, setFocusedPieceIndex] = useState<number | null>(null); // For keyboard navigation
  const lastTouchTimeRef = useRef<number>(0); // Track last touch time to distinguish from mouse events

  // Convert units to consistent internal units (meters for length, cm for width)
  // Handle string values by parsing to number
  const originalLengthNum = typeof originalLength === 'string' ? parseFloat(originalLength) || 0 : (originalLength || 0);
  const originalWidthNum = typeof originalWidth === 'string' ? parseFloat(originalWidth) || 0 : (originalWidth || 0);
  
  const originalLengthInMeters = lengthToMeters(originalLengthNum, lengthUnit);
  const originalWidthInCm = widthToCm(originalWidthNum, widthUnit);
  
  // Calculate initial cut dimensions if product is cut
  // For initial cuts, used area = product dimensions
  const productLengthNum = productLength || 0;
  const productWidthNum = productWidth || 0;
  const productLengthInMeters = productLengthNum > 0 ? lengthToMeters(productLengthNum, productLengthUnit) : 0;
  const productWidthInCm = productWidthNum > 0 ? widthToCm(productWidthNum, productWidthUnit) : 0;
  
  // If product is cut, calculate initial used area from product dimensions
  // Otherwise, use provided usedLength/usedWidth (for remaining stone usage)
  // ðŸŽ¯ FIX: For products with explicit remainingStones positions (e.g., layers),
  // don't calculate initialCutWidth/initialCutLength from product dimensions
  // The usedWidth/usedLength already represent the used area correctly
  const hasExplicitRemainingPositions = remainingStones && remainingStones.some(rs => rs.position);
  const initialCutLength = (isCut && !hasExplicitRemainingPositions && productLengthInMeters > 0) ? productLengthInMeters : 0;
  const initialCutWidth = (isCut && !hasExplicitRemainingPositions && productWidthInCm > 0 && originalWidthInCm > productWidthInCm) ? productWidthInCm : 0;
  
  // Total used area = initial cut + remaining stone usage
  // ðŸŽ¯ FIX: For products with explicit positions, usedWidth/usedLength already include everything
  // So we should use them directly without adding initialCutWidth/initialCutLength
  const totalUsedLengthInMeters = hasExplicitRemainingPositions 
    ? (usedLength || 0) // For layers, usedLength already represents the used area
    : (initialCutLength + (usedLength || 0));
  const totalUsedWidthInCm = hasExplicitRemainingPositions
    ? (usedWidth || 0) // For layers, usedWidth already represents the used area
    : (initialCutWidth + (usedWidth || 0));

  // Calculate remaining dimensions (using total used dimensions)
  const remainingLengthInMeters = Math.max(0, originalLengthInMeters - totalUsedLengthInMeters);
  // ðŸŽ¯ FIX: For products with explicit remainingStones positions (e.g., layers),
  // don't calculate remainingWidth from usedWidth to avoid conflicts
  // The remainingStones array already contains the correctly positioned pieces
  // (hasExplicitRemainingPositions is already declared above)
  const remainingWidthInCm = hasExplicitRemainingPositions 
    ? 0 // Don't create primaryRemainingPiece when we have explicit positions
    : Math.max(0, originalWidthInCm - totalUsedWidthInCm);
  
  // Calculate primary remaining piece from initial cut (if cut was made)
  // This is the piece that remains after cutting from the original stone
  // For longitudinal cuts: remaining piece is (remainingWidth � fullLength) positioned next to the used piece
  const primaryRemainingPiece = isCut && initialCutWidth > 0 && remainingWidthInCm > 0 ? {
    id: 'primary-remaining',
    width: remainingWidthInCm,
    length: initialCutLength || originalLengthInMeters, // Use cut length if available, otherwise full length
    squareMeters: ((remainingWidthInCm / 100) * (initialCutLength || originalLengthInMeters)),
    isAvailable: true,
    sourceCutId: 'initial-cut'
  } : null;

  // Calculate aspect ratio for proper canvas sizing
  const stoneAspectRatio = calculateAspectRatio(originalLengthInMeters, originalWidthInCm);

  // Responsive canvas sizing
  const resizeCanvas = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    
    if (!container || !canvas) return;

    // Get container dimensions
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    
    // Calculate canvas dimensions
    // Default width: 280px or container width (whichever is smaller)
    const defaultWidth = typeof width === 'number' ? width : (typeof width === 'string' ? parseInt(width) : 280);
    const canvasWidth = Math.min(defaultWidth, containerWidth - 32); // 32px for padding
    
    // Height based on aspect ratio of original stone or default
    const defaultHeight = typeof height === 'number' ? height : (typeof height === 'string' ? parseInt(height) : 140);
    
    // Use calculated aspect ratio if available, otherwise use default
    const aspectRatio = stoneAspectRatio > 0 ? stoneAspectRatio : (defaultHeight / canvasWidth);
    
    // Calculate height maintaining aspect ratio
    const calculatedHeight = canvasWidth / aspectRatio;
    const canvasHeight = Math.max(defaultHeight, calculatedHeight);

    // Handle high-DPI displays
    const dpr = window.devicePixelRatio || 1;
    
    // Set display size (CSS pixels)
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    
    // Set actual size (device pixels)
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    
    // Scale context to account for device pixel ratio
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    setCanvasSize({ width: canvasWidth, height: canvasHeight });
  }, [width, height, originalLengthInMeters, originalWidthInCm]);

  // Initialize canvas and handle resize
  useEffect(() => {
    resizeCanvas();

    // Handle window resize
    const handleResize = () => {
      resizeCanvas();
    };

    window.addEventListener('resize', handleResize);
    
    // Use ResizeObserver for container size changes
    const container = containerRef.current;
    let resizeObserver: ResizeObserver | null = null;
    
    if (container && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        resizeCanvas();
      });
      resizeObserver.observe(container);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeObserver && container) {
        resizeObserver.unobserve(container);
      }
    };
  }, [resizeCanvas]);

  // === Phase 3, Task 2: Sub-Service Pattern Utilities ===
  /**
   * Get pattern color for a sub-service based on its index
   */
  const getSubServicePatternColor = (index: number, isDark: boolean): { fill: string; pattern: string } => {
    const patterns = [
      { fill: isDark ? 'rgba(168, 85, 247, 0.3)' : 'rgba(168, 85, 247, 0.25)', pattern: 'vertical' }, // purple - vertical lines
      { fill: isDark ? 'rgba(59, 130, 246, 0.3)' : 'rgba(59, 130, 246, 0.25)', pattern: 'horizontal' }, // blue - horizontal lines
      { fill: isDark ? 'rgba(236, 72, 153, 0.3)' : 'rgba(236, 72, 153, 0.25)', pattern: 'diagonal' }, // pink - diagonal lines
      { fill: isDark ? 'rgba(20, 184, 166, 0.3)' : 'rgba(20, 184, 166, 0.25)', pattern: 'cross' }, // teal - cross hatch
      { fill: isDark ? 'rgba(251, 146, 60, 0.3)' : 'rgba(251, 146, 60, 0.25)', pattern: 'dots' }, // orange - dots
      { fill: isDark ? 'rgba(34, 197, 94, 0.3)' : 'rgba(34, 197, 94, 0.25)', pattern: 'grid' }, // green - grid
    ];
    return patterns[index % patterns.length];
  };

  /**
   * Get border color for a sub-service based on its index
   */
  const getSubServiceBorderColor = (index: number, isDark: boolean): string => {
    const colors = [
      isDark ? 'rgba(168, 85, 247, 0.6)' : 'rgba(168, 85, 247, 0.5)', // purple
      isDark ? 'rgba(59, 130, 246, 0.6)' : 'rgba(59, 130, 246, 0.5)', // blue
      isDark ? 'rgba(236, 72, 153, 0.6)' : 'rgba(236, 72, 153, 0.5)', // pink
      isDark ? 'rgba(20, 184, 166, 0.6)' : 'rgba(20, 184, 166, 0.5)', // teal
      isDark ? 'rgba(251, 146, 60, 0.6)' : 'rgba(251, 146, 60, 0.5)', // orange
      isDark ? 'rgba(34, 197, 94, 0.6)' : 'rgba(34, 197, 94, 0.5)', // green
    ];
    return colors[index % colors.length];
  };

  /**
   * Draw pattern on canvas for sub-service visualization
   */
  const drawSubServicePattern = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    index: number,
    patternType: string,
    isDark: boolean
  ): void => {
    ctx.save();
    const patternColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
    ctx.strokeStyle = patternColor;
    ctx.lineWidth = 1;
    
    switch (patternType) {
      case 'vertical':
        // Vertical lines
        ctx.setLineDash([]);
        const verticalSpacing = 6;
        for (let i = x + verticalSpacing; i < x + width; i += verticalSpacing) {
          ctx.beginPath();
          ctx.moveTo(i, y);
          ctx.lineTo(i, y + height);
          ctx.stroke();
        }
        break;
        
      case 'horizontal':
        // Horizontal lines
        ctx.setLineDash([]);
        const horizontalSpacing = 6;
        for (let i = y + horizontalSpacing; i < y + height; i += horizontalSpacing) {
          ctx.beginPath();
          ctx.moveTo(x, i);
          ctx.lineTo(x + width, i);
          ctx.stroke();
        }
        break;
        
      case 'diagonal':
        // Diagonal lines (top-left to bottom-right)
        ctx.setLineDash([]);
        const diagonalSpacing = 8;
        for (let i = -width; i < height; i += diagonalSpacing) {
          ctx.beginPath();
          ctx.moveTo(x, y + i);
          ctx.lineTo(x + width + Math.abs(i), y + i + width);
          ctx.stroke();
        }
        break;
        
      case 'cross':
        // Cross hatch (both diagonal directions)
        ctx.setLineDash([]);
        const crossSpacing = 8;
        // First diagonal direction
        for (let i = -width; i < height; i += crossSpacing) {
          ctx.beginPath();
          ctx.moveTo(x, y + i);
          ctx.lineTo(x + width + Math.abs(i), y + i + width);
          ctx.stroke();
        }
        // Second diagonal direction
        for (let i = 0; i < width + height; i += crossSpacing) {
          ctx.beginPath();
          ctx.moveTo(x + i, y);
          ctx.lineTo(x + i - height, y + height);
          ctx.stroke();
        }
        break;
        
      case 'dots':
        // Dot pattern
        ctx.fillStyle = patternColor;
        const dotSpacing = 5;
        for (let dotY = y + dotSpacing; dotY < y + height; dotY += dotSpacing * 2) {
          for (let dotX = x + dotSpacing; dotX < x + width; dotX += dotSpacing * 2) {
            ctx.beginPath();
            ctx.arc(dotX, dotY, 1, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
        
      case 'grid':
        // Grid pattern (both vertical and horizontal)
        ctx.setLineDash([]);
        const gridSpacing = 6;
        // Vertical lines
        for (let i = x + gridSpacing; i < x + width; i += gridSpacing) {
          ctx.beginPath();
          ctx.moveTo(i, y);
          ctx.lineTo(i, y + height);
          ctx.stroke();
        }
        // Horizontal lines
        for (let i = y + gridSpacing; i < y + height; i += gridSpacing) {
          ctx.beginPath();
          ctx.moveTo(x, i);
          ctx.lineTo(x + width, i);
          ctx.stroke();
        }
        break;
        
      default:
        // Default: diagonal
        ctx.setLineDash([]);
        const defaultSpacing = 8;
        for (let i = -width; i < height; i += defaultSpacing) {
          ctx.beginPath();
          ctx.moveTo(x, y + i);
          ctx.lineTo(x + width + Math.abs(i), y + i + width);
          ctx.stroke();
        }
    }
    
    ctx.restore();
  };

  // === Phase 2: Hit Detection System ===
  /**
   * Get the clicked area (remaining stone) at the given canvas coordinates
   * @param canvasX - X coordinate on canvas (in CSS pixels)
   * @param canvasY - Y coordinate on canvas (in CSS pixels)
   * @returns ClickableArea if point is inside a remaining stone, null otherwise
   */
  const getClickedArea = useCallback((canvasX: number, canvasY: number): ClickableArea | null => {
    // Check each clickable area (coordinates are already in CSS pixels, matching the rect)
    for (const area of clickableAreasRef.current) {
      if (isPointInRect(canvasX, canvasY, area.rect)) {
        return area;
      }
    }

    return null;
  }, []);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get the actual canvas buffer size (accounting for high-DPI)
    const dpr = window.devicePixelRatio || 1;
    const bufferWidth = canvas.width;
    const bufferHeight = canvas.height;
    
    // CSS display size (for drawing calculations)
    const { width: canvasWidth, height: canvasHeight } = canvasSize;
    const padding = 20; // Padding from edges in pixels

    // Clear the entire buffer (not just CSS size)
    const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const bgColor = isDarkMode ? '#1e293b' : '#f8fafc'; // slate-800 : slate-50
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, bufferWidth, bufferHeight);

    // IMPORTANT: Reset transform and scale for high-DPI
    // The scale was set in resizeCanvas, but we need to ensure it's correct here
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
    ctx.scale(dpr, dpr); // Scale for high-DPI displays

    // Debug: Log current values to console (only log once per render to avoid spam)
    if (!debugLogged.current) {
      const logData = {
        // Props
        originalLength,
        originalWidth,
        productLength,
        productWidth,
        isCut,
        usedLength,
        usedWidth,
        // Parsed values
        originalLengthNum,
        originalWidthNum,
        productLengthInMeters,
        productWidthInCm,
        // Calculated values
        initialCutLength,
        initialCutWidth,
        totalUsedLengthInMeters,
        totalUsedWidthInCm,
        remainingWidthInCm,
        remainingLengthInMeters,
        primaryRemainingPiece,
        // Canvas info
        canvasSize
      };
      console.log('ðŸŽ¨ StoneCanvas Rendering:', logData);
      console.log('ðŸ” Critical Calculations:', {
        'isCut?': isCut,
        'productLength?': productLength,
        'productWidth?': productWidth,
        'productLengthInMeters?': productLengthInMeters,
        'productWidthInCm?': productWidthInCm,
        'originalWidthInCm?': originalWidthInCm,
        'originalLengthInMeters?': originalLengthInMeters,
        'Condition: isCut && productLengthInMeters > 0': isCut && productLengthInMeters > 0,
        'Condition: isCut && productWidthInCm > 0 && originalWidthInCm > productWidthInCm': isCut && productWidthInCm > 0 && originalWidthInCm > productWidthInCm,
        'initialCutLength result': initialCutLength,
        'initialCutWidth result': initialCutWidth,
        'totalUsedLengthInMeters': totalUsedLengthInMeters,
        'totalUsedWidthInCm': totalUsedWidthInCm,
        'remainingWidthInCm': remainingWidthInCm,
        'remainingLengthInMeters': remainingLengthInMeters,
        'primaryRemainingPiece exists?': primaryRemainingPiece !== null,
        'primaryRemainingPiece': primaryRemainingPiece,
        'Will draw used area?': totalUsedLengthInMeters > 0 || totalUsedWidthInCm > 0,
        'Will draw remaining piece?': primaryRemainingPiece !== null,
        'allRemainingPiecesCount': (primaryRemainingPiece ? 1 : 0) + (remainingStones?.length || 0),
        'remainingStones': remainingStones?.map(rs => ({
          id: rs.id,
          width: rs.width,
          length: rs.length,
          hasPosition: !!rs.position
        })) || []
      });
      
      // Additional debug for rendering
      console.log('ðŸŽ¨ Rendering Debug:', {
        'originalRect calculated?': originalLengthInMeters > 0 && originalWidthInCm > 0,
        'canvasSize': canvasSize,
        'Will draw used area condition': totalUsedLengthInMeters > 0 || totalUsedWidthInCm > 0,
        'Will draw remaining condition': primaryRemainingPiece !== null || (remainingStones && remainingStones.length > 0)
      });
      debugLogged.current = true;
      setTimeout(() => { debugLogged.current = false; }, 1000);
    }

    // Check if we have valid dimensions
    if (originalLengthInMeters <= 0 || originalWidthInCm <= 0) {
      // Draw error message
      ctx.fillStyle = isDarkMode ? '#ef4444' : '#dc2626'; // red-500 : red-600
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ابعاد نامعتبر', canvasWidth / 2, canvasHeight / 2);
      return;
    }

    // Calculate original stone rectangle using coordinate utilities
    const originalRect: CanvasRect = realToCanvasRect(
      0, // start at 0
      originalLengthInMeters, // full length
      0, // start at 0
      originalWidthInCm, // full width
      originalLengthInMeters,
      originalWidthInCm,
      canvasWidth,
      canvasHeight,
      padding
    );

    // === Phase 1, Task 4: Draw Background (Original Stone Outline) ===
    
    // Draw background rectangle with glass morphism effect
    // Create gradient for subtle depth
    const gradient = ctx.createLinearGradient(
      originalRect.x,
      originalRect.y,
      originalRect.x + originalRect.width,
      originalRect.y + originalRect.height
    );
    
    if (isDarkMode) {
      // Dark mode: more visible gradient from slate-600 to slate-700
      gradient.addColorStop(0, '#475569'); // slate-600 (brighter)
      gradient.addColorStop(1, '#334155'); // slate-700
    } else {
      // Light mode: more visible gradient from slate-200 to slate-300
      gradient.addColorStop(0, '#e2e8f0'); // slate-200
      gradient.addColorStop(1, '#cbd5e1'); // slate-300
    }
    
    // Fill the original stone rectangle
    ctx.fillStyle = gradient;
    ctx.fillRect(originalRect.x, originalRect.y, originalRect.width, originalRect.height);
    
    // Draw outline/border with more visible color
    const borderColor = isDarkMode ? '#64748b' : '#94a3b8'; // slate-500 : slate-400 (more visible)
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2.5; // Slightly thicker for better visibility
    ctx.strokeRect(originalRect.x, originalRect.y, originalRect.width, originalRect.height);
    
    // Add subtle inner shadow effect (by drawing a slightly inset rectangle with opacity)
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = isDarkMode ? '#000000' : '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      originalRect.x + 1,
      originalRect.y + 1,
      originalRect.width - 2,
      originalRect.height - 2
    );
    ctx.restore();

    // === Phase 1, Task 5: Draw Used Areas with Color Coding ===
    
    // CRITICAL: Partitions are stored in usedRemainingStones, not remainingStones!
    // Identify partitions that should be shown as "used" overlays
    // Partitions are usedRemainingStones with position field and id starting with 'partition_remaining_'
    const partitionUsedAreas = (usedRemainingStones || []).filter(rs => 
      rs.position && rs.id.startsWith('partition_remaining_')
    );
    
    // All remainingStones are actual remaining pieces (gaps), no need to filter
    const actualRemainingStones = remainingStones || [];
    
    // Draw partition used areas first (these are positioned within the primary remaining area)
    if (partitionUsedAreas.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(originalRect.x, originalRect.y, originalRect.width, originalRect.height);
      ctx.clip();
      
      const usedColor = isDarkMode 
        ? 'rgba(239, 68, 68, 0.4)' // red-500 with 40% opacity (dark mode)
        : 'rgba(249, 115, 22, 0.35)'; // orange-500 with 35% opacity (light mode)
      
      const usedBorderColor = isDarkMode 
        ? 'rgba(239, 68, 68, 0.6)' // red-500 with 60% opacity (dark mode)
        : 'rgba(249, 115, 22, 0.5)'; // orange-500 with 50% opacity (light mode)
      
      // Color palette for partitions - highly distinguishable colors for better UX
      // Using distinct hues with good contrast: Red, Blue, Green, Yellow, Purple, Cyan, Magenta, Orange
      const partitionColors = isDarkMode ? [
        { fill: 'rgba(239, 68, 68, 0.45)', border: 'rgba(239, 68, 68, 0.75)', hatch: 'rgba(239, 68, 68, 0.35)' }, // Bright Red - #EF4444
        { fill: 'rgba(59, 130, 246, 0.45)', border: 'rgba(59, 130, 246, 0.75)', hatch: 'rgba(59, 130, 246, 0.35)' }, // Bright Blue - #3B82F6
        { fill: 'rgba(34, 197, 94, 0.45)', border: 'rgba(34, 197, 94, 0.75)', hatch: 'rgba(34, 197, 94, 0.35)' }, // Bright Green - #22C55E
        { fill: 'rgba(234, 179, 8, 0.45)', border: 'rgba(234, 179, 8, 0.75)', hatch: 'rgba(234, 179, 8, 0.35)' }, // Bright Yellow - #EAB308
        { fill: 'rgba(168, 85, 247, 0.45)', border: 'rgba(168, 85, 247, 0.75)', hatch: 'rgba(168, 85, 247, 0.35)' }, // Bright Purple - #A855F7
        { fill: 'rgba(6, 182, 212, 0.45)', border: 'rgba(6, 182, 212, 0.75)', hatch: 'rgba(6, 182, 212, 0.35)' }, // Bright Cyan - #06B6D4
        { fill: 'rgba(236, 72, 153, 0.45)', border: 'rgba(236, 72, 153, 0.75)', hatch: 'rgba(236, 72, 153, 0.35)' }, // Bright Pink/Magenta - #EC4899
        { fill: 'rgba(249, 115, 22, 0.45)', border: 'rgba(249, 115, 22, 0.75)', hatch: 'rgba(249, 115, 22, 0.35)' }, // Bright Orange - #F97316
        { fill: 'rgba(139, 92, 246, 0.45)', border: 'rgba(139, 92, 246, 0.75)', hatch: 'rgba(139, 92, 246, 0.35)' }, // Violet - #8B5CF6
        { fill: 'rgba(20, 184, 166, 0.45)', border: 'rgba(20, 184, 166, 0.75)', hatch: 'rgba(20, 184, 166, 0.35)' }, // Teal - #14B8A6
        { fill: 'rgba(251, 191, 36, 0.45)', border: 'rgba(251, 191, 36, 0.75)', hatch: 'rgba(251, 191, 36, 0.35)' }, // Amber - #FBBF24
        { fill: 'rgba(14, 165, 233, 0.45)', border: 'rgba(14, 165, 233, 0.75)', hatch: 'rgba(14, 165, 233, 0.35)' }, // Sky Blue - #0EA5E9
      ] : [
        { fill: 'rgba(220, 38, 38, 0.4)', border: 'rgba(220, 38, 38, 0.65)', hatch: 'rgba(220, 38, 38, 0.3)' }, // Bright Red - #DC2626
        { fill: 'rgba(37, 99, 235, 0.4)', border: 'rgba(37, 99, 235, 0.65)', hatch: 'rgba(37, 99, 235, 0.3)' }, // Bright Blue - #2563EB
        { fill: 'rgba(22, 163, 74, 0.4)', border: 'rgba(22, 163, 74, 0.65)', hatch: 'rgba(22, 163, 74, 0.3)' }, // Bright Green - #16A34A
        { fill: 'rgba(202, 138, 4, 0.4)', border: 'rgba(202, 138, 4, 0.65)', hatch: 'rgba(202, 138, 4, 0.3)' }, // Bright Yellow - #CA8A04
        { fill: 'rgba(147, 51, 234, 0.4)', border: 'rgba(147, 51, 234, 0.65)', hatch: 'rgba(147, 51, 234, 0.3)' }, // Bright Purple - #9333EA
        { fill: 'rgba(8, 145, 178, 0.4)', border: 'rgba(8, 145, 178, 0.65)', hatch: 'rgba(8, 145, 178, 0.3)' }, // Bright Cyan - #0891B2
        { fill: 'rgba(219, 39, 119, 0.4)', border: 'rgba(219, 39, 119, 0.65)', hatch: 'rgba(219, 39, 119, 0.3)' }, // Bright Pink/Magenta - #DB2777
        { fill: 'rgba(234, 88, 12, 0.4)', border: 'rgba(234, 88, 12, 0.65)', hatch: 'rgba(234, 88, 12, 0.3)' }, // Bright Orange - #EA580C
        { fill: 'rgba(124, 58, 237, 0.4)', border: 'rgba(124, 58, 237, 0.65)', hatch: 'rgba(124, 58, 237, 0.3)' }, // Violet - #7C3AED
        { fill: 'rgba(17, 94, 89, 0.4)', border: 'rgba(17, 94, 89, 0.65)', hatch: 'rgba(17, 94, 89, 0.3)' }, // Teal - #115E59
        { fill: 'rgba(217, 119, 6, 0.4)', border: 'rgba(217, 119, 6, 0.65)', hatch: 'rgba(217, 119, 6, 0.3)' }, // Amber - #D97706
        { fill: 'rgba(2, 132, 199, 0.4)', border: 'rgba(2, 132, 199, 0.65)', hatch: 'rgba(2, 132, 199, 0.3)' }, // Sky Blue - #0284C7
      ];
      
      partitionUsedAreas.forEach((partition, index) => {
        if (!partition.position) return;
        
        // Get unique color for this partition (cycle through palette)
        const colorIndex = index % partitionColors.length;
        const partitionColor = partitionColors[colorIndex];
        
        // Calculate partition position relative to original stone
        // For partitions from primary remaining, position is relative to where primary remaining starts
        // Primary remaining starts at (initialCutWidth, 0) in the original stone coordinate system
        const partitionStartLength = partition.position.startLength;
        const partitionStartWidth = initialCutWidth + partition.position.startWidth; // Offset by primary remaining position
        const partitionLength = partition.length > 100 ? partition.length / 100 : partition.length; // Convert to meters if needed
        const partitionWidth = partition.width;
        
        const partitionRect: CanvasRect = realToCanvasRect(
          partitionStartLength,
          partitionLength,
          partitionStartWidth,
          partitionWidth,
          originalLengthInMeters,
          originalWidthInCm,
          canvasWidth,
          canvasHeight,
          padding
        );
        
        // Clamp to original bounds
        const clampedX = Math.max(partitionRect.x, originalRect.x);
        const clampedY = Math.max(partitionRect.y, originalRect.y);
        const clampedWidth = Math.min(
          partitionRect.x + partitionRect.width - clampedX,
          originalRect.x + originalRect.width - clampedX
        );
        const clampedHeight = Math.min(
          partitionRect.y + partitionRect.height - clampedY,
          originalRect.y + originalRect.height - clampedY
        );
        
        if (clampedWidth > 0 && clampedHeight > 0) {
          // Draw used overlay for partition with unique color
          ctx.fillStyle = partitionColor.fill;
          ctx.fillRect(clampedX, clampedY, clampedWidth, clampedHeight);
          
          // Draw border with unique color
          ctx.strokeStyle = partitionColor.border;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(clampedX, clampedY, clampedWidth, clampedHeight);
          
          // Draw diagonal hatch pattern with unique color
          ctx.save();
          ctx.strokeStyle = partitionColor.hatch;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          
          const lineSpacing = 8;
          const maxDim = Math.max(clampedWidth, clampedHeight);
          const numLines = Math.ceil(maxDim / lineSpacing) + 2;
          
          for (let i = -1; i <= numLines; i++) {
            const offset = i * lineSpacing;
            ctx.beginPath();
            if (clampedWidth > clampedHeight) {
              const startX = clampedX + offset;
              const startY = clampedY;
              const endX = clampedX + clampedWidth + offset;
              const endY = clampedY + clampedHeight;
              ctx.moveTo(startX, startY);
              ctx.lineTo(endX, endY);
            } else {
              const startX = clampedX;
              const startY = clampedY + offset;
              const endX = clampedX + clampedWidth;
              const endY = clampedY + clampedHeight + offset;
              ctx.moveTo(startX, startY);
              ctx.lineTo(endX, endY);
            }
            ctx.stroke();
          }
          ctx.restore();
        }
      });
      
      ctx.restore();
    }
    
    // Draw main used area (initial cut) if there's something used
    // ðŸŽ¯ Store used area end position for precise remaining stone positioning
    let usedAreaEndY: number | null = null;
    
    // ðŸŽ¯ FIX: For layers, we need to ensure used area is drawn correctly
    // Even if usedLength is 0, we should still draw if usedWidth > 0
    // For layers, usedLength represents the full length across which the layer width is cut
    if (totalUsedLengthInMeters > 0 || totalUsedWidthInCm > 0) {
      // Clamp used dimensions to not exceed original dimensions
      const clampedUsedLength = Math.min(totalUsedLengthInMeters, originalLengthInMeters);
      const clampedUsedWidth = Math.min(totalUsedWidthInCm, originalWidthInCm);
      
      // ðŸŽ¯ FIX: For layers (hasExplicitRemainingPositions), if usedLength is 0 but usedWidth > 0,
      // use the full original length to draw the used area correctly
      const lengthToUse = (hasExplicitRemainingPositions && clampedUsedLength === 0 && clampedUsedWidth > 0)
        ? originalLengthInMeters // Use full length for layers
        : clampedUsedLength;
      
      // Calculate used area rectangle
      // Used area starts at (0, 0) and extends to (lengthToUse, clampedUsedWidth)
      const usedRect: CanvasRect = realToCanvasRect(
        0, // start at 0 (beginning of stone)
        lengthToUse, // length used (full length for layers)
        0, // start at 0 (beginning of stone)
        clampedUsedWidth, // width used
        originalLengthInMeters,
        originalWidthInCm,
        canvasWidth,
        canvasHeight,
        padding
      );

      // Only draw if the rectangle has valid dimensions
      // For layers, we allow drawing even if width is small (as long as height > 0)
      if (usedRect.width > 0 && usedRect.height > 0) {
        // Clamp used rectangle to original stone bounds to prevent overflow
        const clampedX = Math.max(usedRect.x, originalRect.x);
        const clampedY = Math.max(usedRect.y, originalRect.y);
        const clampedWidth = Math.min(
          usedRect.x + usedRect.width - clampedX,
          originalRect.x + originalRect.width - clampedX
        );
        const clampedHeight = Math.min(
          usedRect.y + usedRect.height - clampedY,
          originalRect.y + originalRect.height - clampedY
        );
        
        // ðŸŽ¯ Store the end Y position of used area for precise remaining stone positioning
        usedAreaEndY = clampedY + clampedHeight;
        
        // Skip if clamped dimensions are invalid
        if (clampedWidth <= 0 || clampedHeight <= 0) {
          // ðŸŽ¯ FIX: Even if used area can't be drawn, calculate usedAreaEndY for remaining stone positioning
          // This is especially important for layers where usedWidth > 0 but usedLength might cause issues
          if (hasExplicitRemainingPositions && totalUsedWidthInCm > 0) {
            // Calculate used area end position directly from usedWidth ratio
            const usedWidthRatio = totalUsedWidthInCm / originalWidthInCm;
            usedAreaEndY = originalRect.y + (usedWidthRatio * originalRect.height);
          }
          return;
        }
        
        // Debug: Log used rect dimensions
        if (!debugLogged.current) {
          console.log('ðŸ“Š Used Area Rect:', {
            usedRect: { x: usedRect.x, y: usedRect.y, width: usedRect.width, height: usedRect.height },
            clampedRect: { x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight },
            originalRect: { x: originalRect.x, y: originalRect.y, width: originalRect.width, height: originalRect.height },
            clampedUsedLength,
            clampedUsedWidth,
            'Will draw?': clampedWidth > 0 && clampedHeight > 0
          });
        }
        
        // Save context before clipping
        ctx.save();
        
        // Clip drawing to original stone bounds
        ctx.beginPath();
        ctx.rect(originalRect.x, originalRect.y, originalRect.width, originalRect.height);
        ctx.clip();
        
        // Draw used area with semi-transparent overlay
        // Use orange/red color to indicate "used" status
        const usedColor = isDarkMode 
          ? 'rgba(239, 68, 68, 0.4)' // red-500 with 40% opacity (dark mode)
          : 'rgba(249, 115, 22, 0.35)'; // orange-500 with 35% opacity (light mode)
        
        ctx.fillStyle = usedColor;
        ctx.fillRect(clampedX, clampedY, clampedWidth, clampedHeight);
        
        // Draw border around used area for better visibility
        const usedBorderColor = isDarkMode 
          ? 'rgba(239, 68, 68, 0.6)' // red-500 with 60% opacity (dark mode)
          : 'rgba(249, 115, 22, 0.5)'; // orange-500 with 50% opacity (light mode)
        
        ctx.strokeStyle = usedBorderColor;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(clampedX, clampedY, clampedWidth, clampedHeight);
        
        // Add diagonal hatch pattern to indicate "used" status
        // Save context for hatch pattern (already clipped to original stone bounds)
        ctx.save();
        
        ctx.strokeStyle = isDarkMode 
          ? 'rgba(239, 68, 68, 0.3)' // red-500 with 30% opacity (dark mode)
          : 'rgba(249, 115, 22, 0.25)'; // orange-500 with 25% opacity (light mode)
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]); // Dashed lines for subtle pattern
        
        // Draw diagonal lines from top-left to bottom-right across the rectangle
        const lineSpacing = 8; // pixels between lines
        const maxDim = Math.max(clampedWidth, clampedHeight);
        const numLines = Math.ceil(maxDim / lineSpacing) + 2;
        
        // Draw lines diagonally across the rectangle, ensuring they stay within bounds
        for (let i = -1; i <= numLines; i++) {
          const offset = i * lineSpacing;
          ctx.beginPath();
          // Draw from top edge to bottom edge (or left to right)
          if (clampedWidth > clampedHeight) {
            // Wider than tall: draw from top-left to bottom-right
            const startX = clampedX + offset;
            const startY = clampedY;
            const endX = clampedX + clampedWidth + offset;
            const endY = clampedY + clampedHeight;
            // Only draw if line intersects the rectangle
            if (endX >= clampedX && startX <= clampedX + clampedWidth) {
              ctx.moveTo(startX, startY);
              ctx.lineTo(endX, endY);
              ctx.stroke();
            }
          } else {
            // Taller than wide: draw from top-left to bottom-right
            const startX = clampedX;
            const startY = clampedY + offset;
            const endX = clampedX + clampedWidth;
            const endY = clampedY + clampedHeight + offset;
            // Only draw if line intersects the rectangle
            if (endY >= clampedY && startY <= clampedY + clampedHeight) {
              ctx.moveTo(startX, startY);
              ctx.lineTo(endX, endY);
              ctx.stroke();
            }
          }
        }
        
        ctx.restore(); // Restore line dash styles (keep original stone clipping)
        ctx.restore(); // Restore original stone clipping
        
        // === Phase 3, Task 2: Draw Sub-Service Overlays on Used Area ===
        // Sub-services overlay on the used area to show where they've been applied
        if (appliedSubServices && appliedSubServices.length > 0) {
          ctx.save();
          
          // Clip to used area bounds
          ctx.beginPath();
          ctx.rect(clampedX, clampedY, clampedWidth, clampedHeight);
          ctx.clip();
          
          // Calculate sub-service overlay areas
          // For length-based sub-services: overlay along the length dimension sequentially
          // For square-meter-based sub-services: overlay proportionally based on square meters
          
          let accumulatedLength = 0; // Track accumulated length for length-based sub-services
          let accumulatedSquareMeters = 0; // Track accumulated square meters for square-meter-based sub-services
          
          appliedSubServices.forEach((applied, index) => {
            if (applied.meter <= 0) return;
            
            let overlayRect: CanvasRect;
            let overlayX: number, overlayY: number, overlayWidthPx: number, overlayHeightPx: number;
            
            if (applied.calculationBase === 'length') {
              // Length-based: overlay along the length (X-axis) sequentially
              const overlayLength = Math.min(applied.meter, clampedUsedLength - accumulatedLength);
              if (overlayLength <= 0) {
                return;
              }
              
              const startLength = accumulatedLength;
              const overlayWidth = clampedUsedWidth; // Full width of used area
              
              overlayRect = realToCanvasRect(
                startLength, // start position along length
                overlayLength, // length of overlay
                0, // start at 0 width (beginning of used area)
                overlayWidth, // full width
                originalLengthInMeters,
                originalWidthInCm,
                canvasWidth,
                canvasHeight,
                padding
              );
              
              // Map to used area coordinates (clampedX, clampedY)
              const normalizedStart = startLength / clampedUsedLength;
              const normalizedLength = overlayLength / clampedUsedLength;
              
              overlayX = clampedX + (normalizedStart * clampedWidth);
              overlayY = clampedY;
              overlayWidthPx = normalizedLength * clampedWidth;
              overlayHeightPx = clampedHeight;
              
              accumulatedLength += overlayLength;
            } else {
              // Square-meter-based: overlay proportionally based on square meters used
              const totalSquareMeters = clampedUsedLength * (clampedUsedWidth / 100); // Convert to square meters
              const overlaySquareMeters = Math.min(applied.meter, totalSquareMeters - accumulatedSquareMeters);
              
              if (overlaySquareMeters <= 0 || totalSquareMeters <= 0) {
                return;
              }
              
              // Calculate proportional area (as a rectangle along the length)
              const normalizedSquareMetersStart = accumulatedSquareMeters / totalSquareMeters;
              const normalizedSquareMetersLength = overlaySquareMeters / totalSquareMeters;
              
              overlayX = clampedX + (normalizedSquareMetersStart * clampedWidth);
              overlayY = clampedY;
              overlayWidthPx = normalizedSquareMetersLength * clampedWidth;
              overlayHeightPx = clampedHeight;
              
              accumulatedSquareMeters += overlaySquareMeters;
            }
            
            if (overlayWidthPx > 0 && overlayHeightPx > 0) {
              // Different patterns for different sub-service types
              const patternColor = getSubServicePatternColor(index, isDarkMode);
              const borderColor = getSubServiceBorderColor(index, isDarkMode);
              
              // Draw semi-transparent overlay
              ctx.fillStyle = patternColor.fill;
              ctx.fillRect(overlayX, overlayY, overlayWidthPx, overlayHeightPx);
              
              // Draw pattern based on sub-service index
              drawSubServicePattern(ctx, overlayX, overlayY, overlayWidthPx, overlayHeightPx, index, patternColor.pattern, isDarkMode);
              
              // Draw border
              ctx.strokeStyle = borderColor;
              ctx.lineWidth = 1.5;
              ctx.strokeRect(overlayX, overlayY, overlayWidthPx, overlayHeightPx);
            }
          });
          
          ctx.restore(); // Restore clipping
        }
      }
    }

    // === Phase 1, Task 6: Draw Remaining Pieces with Distinct Colors ===
    
    // === Phase 2: Reset clickable areas at the start of each render ===
    clickableAreasRef.current = [];
    
    // Combine primary remaining piece (from initial cut) with remaining stones from array
    const allRemainingPieces: RemainingStone[] = [];
    
    // Check if any partitions were created from primary remaining
    // If so, hide the primary remaining piece since it's been "used" to create partitions
    const hasPartitionsFromPrimary = partitionUsedAreas.length > 0;
    
    // ðŸŽ¯ FIX: Check if we have remaining stones with explicit positions (e.g., from layers)
    // If so, don't create primaryRemainingPiece to avoid duplication
    // Remaining stones with positions are explicitly calculated and positioned
    const hasRemainingStonesWithPositions = actualRemainingStones && actualRemainingStones.some(rs => rs.position);
    
    // Add primary remaining piece only if:
    // 1. It hasn't been used for partitions
    // 2. We don't have remaining stones with explicit positions (to avoid duplication)
    if (primaryRemainingPiece && primaryRemainingPiece.isAvailable && !hasPartitionsFromPrimary && !hasRemainingStonesWithPositions) {
      allRemainingPieces.push(primaryRemainingPiece);
    }
    
    // Add actual remaining stones from array (excluding partition pieces which are shown as used)
    if (actualRemainingStones && actualRemainingStones.length > 0) {
      console.log('ðŸŽ¨ Canvas: Adding remaining stones to canvas:', {
        totalRemainingStonesCount: remainingStones?.length || 0,
        partitionUsedAreasCount: partitionUsedAreas.length,
        actualRemainingStonesCount: actualRemainingStones.length,
        hasPartitionsFromPrimary,
        primaryRemainingHidden: hasPartitionsFromPrimary,
        remainingStones: actualRemainingStones.map(rs => ({
          id: rs.id,
          width: rs.width,
          length: rs.length,
          hasPosition: !!rs.position,
          position: rs.position,
          sourceCutId: rs.sourceCutId
        }))
      });
      allRemainingPieces.push(...actualRemainingStones);
    }
    
    console.log('ðŸŽ¨ Canvas: Total remaining pieces to render:', {
      primaryRemaining: primaryRemainingPiece ? 1 : 0,
      partitionUsedAreas: partitionUsedAreas.length,
      actualRemainingStones: actualRemainingStones?.length || 0,
      total: allRemainingPieces.length,
      pieces: allRemainingPieces.map(p => ({
        id: p.id,
        width: p.width,
        length: p.length,
        hasPosition: !!p.position
      }))
    });
    
    // Draw each remaining stone piece with distinct colors
    if (allRemainingPieces.length > 0) {
      // Color palette for remaining stones (different shades of green/blue/teal)
      // Each piece gets a distinct color based on its index
      const remainingColors = isDarkMode ? [
        'rgba(34, 197, 94, 0.5)',   // green-500 (dark mode)
        'rgba(59, 130, 246, 0.5)',  // blue-500 (dark mode)
        'rgba(20, 184, 166, 0.5)',  // teal-500 (dark mode)
        'rgba(168, 85, 247, 0.5)',  // purple-500 (dark mode)
        'rgba(236, 72, 153, 0.5)',  // pink-500 (dark mode)
        'rgba(251, 146, 60, 0.5)',  // orange-500 (dark mode)
      ] : [
        'rgba(34, 197, 94, 0.4)',   // green-500 (light mode)
        'rgba(59, 130, 246, 0.4)',  // blue-500 (light mode)
        'rgba(20, 184, 166, 0.4)',  // teal-500 (light mode)
        'rgba(168, 85, 247, 0.4)',  // purple-500 (light mode)
        'rgba(236, 72, 153, 0.4)',  // pink-500 (light mode)
        'rgba(251, 146, 60, 0.4)',  // orange-500 (light mode)
      ];
      
      const remainingBorderColors = isDarkMode ? [
        'rgba(34, 197, 94, 0.7)',   // green-500 (dark mode)
        'rgba(59, 130, 246, 0.7)',  // blue-500 (dark mode)
        'rgba(20, 184, 166, 0.7)',  // teal-500 (dark mode)
        'rgba(168, 85, 247, 0.7)',  // purple-500 (dark mode)
        'rgba(236, 72, 153, 0.7)',  // pink-500 (dark mode)
        'rgba(251, 146, 60, 0.7)',  // orange-500 (dark mode)
      ] : [
        'rgba(34, 197, 94, 0.6)',   // green-500 (light mode)
        'rgba(59, 130, 246, 0.6)',  // blue-500 (light mode)
        'rgba(20, 184, 166, 0.6)',  // teal-500 (light mode)
        'rgba(168, 85, 247, 0.6)',  // purple-500 (light mode)
        'rgba(236, 72, 153, 0.6)',  // pink-500 (light mode)
        'rgba(251, 146, 60, 0.6)',  // orange-500 (light mode)
      ];

      allRemainingPieces.forEach((remainingStone, index) => {
        // Skip if not available or has invalid dimensions
        if (!remainingStone.isAvailable || remainingStone.length <= 0 || remainingStone.width <= 0) {
          return;
        }

        // Calculate position of remaining stone
        // Priority: Use position field if available (for partitions), otherwise use sequential positioning
        let remainingStartLength: number;
        let remainingStartWidth: number;
        let stoneLengthInMeters: number;
        
        if (remainingStone.id === 'primary-remaining') {
          // Primary remaining piece: positioned next to the cut piece (same start position for length, after used width)
          remainingStartLength = 0; // Same length start as used piece
          remainingStartWidth = initialCutWidth; // Start after the used width
          stoneLengthInMeters = remainingStone.length; // Already in meters
        } else if (remainingStone.position) {
          // Remaining stone with explicit position (from partitions): use the position field
          remainingStartLength = remainingStone.position.startLength;
          remainingStartWidth = remainingStone.position.startWidth;
          // ðŸŽ¯ FIX: For layers with explicit positions, ensure remaining stone starts AFTER used area
          // This prevents overlap when position.startWidth might be slightly off due to rounding
          if (hasExplicitRemainingPositions && totalUsedWidthInCm > 0) {
            // Ensure remaining stone starts at least at the end of used area
            remainingStartWidth = Math.max(remainingStartWidth, totalUsedWidthInCm);
          }
          // Convert length from cm to meters if needed (remaining stones store length in cm when from old system)
          // For partitions, length is already in meters
          stoneLengthInMeters = remainingStone.length > 100 ? remainingStone.length / 100 : remainingStone.length;
          
          // ðŸŽ¯ FIX: For layers, if startLength is 0, use the full used length (which is the original length)
          // This ensures the remaining stone spans the full length after the used width
          if (hasExplicitRemainingPositions && remainingStartLength === 0 && totalUsedLengthInMeters > 0) {
            remainingStartLength = 0; // Start at beginning (correct for layers)
            // The length of the remaining stone should span the full original length
            stoneLengthInMeters = Math.max(stoneLengthInMeters, originalLengthInMeters);
          }
          
          // ðŸŽ¯ FIX: For layers, ensure remaining stone is positioned correctly relative to used area
          // Calculate the exact width that should remain after the used area
          let remainingStoneWidth = remainingStone.width;
          
          // For layers with explicit positions, validate that remaining stone fits correctly
          if (hasExplicitRemainingPositions) {
            // Calculate what the remaining width should be based on original and used
            const expectedRemainingWidth = originalWidthInCm - totalUsedWidthInCm;
            
            // Ensure remaining stone starts exactly where used area ends
            remainingStartWidth = totalUsedWidthInCm;
            
            // Use the calculated remaining width (should match remainingStone.width, but use calculated for precision)
            remainingStoneWidth = Math.max(0, expectedRemainingWidth);
            
            // Validate: remainingStartWidth + remainingStoneWidth should equal originalWidthInCm
            const totalCalculated = remainingStartWidth + remainingStoneWidth;
            if (Math.abs(totalCalculated - originalWidthInCm) > 0.01) {
              // Adjust to ensure exact fit
              remainingStoneWidth = Math.max(0, originalWidthInCm - remainingStartWidth);
            }
          } else {
            // For non-layer products, validate bounds
            const remainingEndWidth = remainingStartWidth + remainingStoneWidth;
            if (remainingEndWidth > originalWidthInCm) {
              remainingStoneWidth = Math.max(0, originalWidthInCm - remainingStartWidth);
            }
          }
          
          // Store adjusted width for use in rectangle calculation
          (remainingStone as any).__adjustedWidth = remainingStoneWidth;
          (remainingStone as any).__adjustedStartWidth = remainingStartWidth;
        } else {
          // Remaining stone without position: use sequential positioning (legacy behavior)
          remainingStartLength = totalUsedLengthInMeters;
          remainingStartWidth = totalUsedWidthInCm;
          // Convert length from cm to meters if needed (remaining stones store length in cm)
          stoneLengthInMeters = remainingStone.length > 100 ? remainingStone.length / 100 : remainingStone.length;
        }
        
        // Calculate remaining stone rectangle using coordinate utilities
        // ðŸŽ¯ FIX: Use adjusted width and start position if available (for layers with position validation)
        const widthToUse = (remainingStone as any).__adjustedWidth !== undefined 
          ? (remainingStone as any).__adjustedWidth 
          : remainingStone.width;
        const startWidthToUse = (remainingStone as any).__adjustedStartWidth !== undefined
          ? (remainingStone as any).__adjustedStartWidth
          : remainingStartWidth;
        const remainingRect: CanvasRect = realToCanvasRect(
          remainingStartLength, // start position for length
          stoneLengthInMeters, // length of remaining piece (in meters)
          startWidthToUse, // start position for width - may be adjusted for layers
          widthToUse, // width of remaining piece (in cm) - may be adjusted
          originalLengthInMeters,
          originalWidthInCm,
          canvasWidth,
          canvasHeight,
          padding
        );

        // Only draw if rectangle has valid dimensions and fits within original stone bounds
        if (remainingRect.width > 0 && remainingRect.height > 0) {
          // Debug: Log remaining rect dimensions
          if (!debugLogged.current && index === 0) {
            console.log('ðŸ“Š Remaining Piece Rect:', {
              remainingStoneId: remainingStone.id,
              remainingRect: { x: remainingRect.x, y: remainingRect.y, width: remainingRect.width, height: remainingRect.height },
              remainingStartLength,
              remainingStartWidth,
              stoneLengthInMeters,
              remainingStoneWidth: remainingStone.width,
              'Will draw?': remainingRect.width > 0 && remainingRect.height > 0
            });
          }
          
          // Check if the remaining rectangle intersects with the original stone rectangle
          const intersectsOriginal = 
            remainingRect.x < originalRect.x + originalRect.width &&
            remainingRect.x + remainingRect.width > originalRect.x &&
            remainingRect.y < originalRect.y + originalRect.height &&
            remainingRect.y + remainingRect.height > originalRect.y;
          
          if (!intersectsOriginal) {
            // Skip if completely outside original stone bounds
            return;
          }

          // Clamp to original stone bounds
          const clampedX = Math.max(remainingRect.x, originalRect.x);
          // ðŸŽ¯ FIX: For layers, use the exact pixel position where used area ends to prevent overlap
          let clampedY: number;
          if (hasExplicitRemainingPositions && usedAreaEndY !== null && usedAreaEndY >= originalRect.y) {
            // Start exactly where used area ends (pixel-perfect alignment)
            clampedY = usedAreaEndY;
            // Calculate height based on the remaining width, ensuring it fits within bounds
            const maxAvailableHeight = originalRect.y + originalRect.height - clampedY;
            // Calculate what the height should be based on the remaining stone width
            const expectedHeight = (widthToUse / originalWidthInCm) * originalRect.height;
            let clampedHeight = Math.min(expectedHeight, maxAvailableHeight);
            
            // ðŸŽ¯ FIX: If calculated height is invalid, recalculate from usedWidth directly
            if (clampedHeight <= 0 && totalUsedWidthInCm > 0) {
              // Calculate used area height in pixels
              const usedWidthRatio = totalUsedWidthInCm / originalWidthInCm;
              const usedHeightInPixels = usedWidthRatio * originalRect.height;
              // Remaining stone starts after used area
              clampedY = originalRect.y + usedHeightInPixels;
              // Calculate remaining height
              const remainingWidthRatio = widthToUse / originalWidthInCm;
              const remainingHeightInPixels = remainingWidthRatio * originalRect.height;
              clampedHeight = Math.min(remainingHeightInPixels, originalRect.y + originalRect.height - clampedY);
            }
            
            if (clampedHeight <= 0) {
              return; // Skip if no space available
            }
            
            const clampedWidth = Math.min(
              remainingRect.x + remainingRect.width - clampedX,
              originalRect.x + originalRect.width - clampedX
            );
            
            // Use the precise clamped values for drawing
            const clickableArea: ClickableArea = {
              x: clampedX,
              y: clampedY,
              width: clampedWidth,
              height: clampedHeight,
              remainingStone: remainingStone,
              rect: {
                x: clampedX,
                y: clampedY,
                width: clampedWidth,
                height: clampedHeight
              }
            };
            
            clickableAreasRef.current.push(clickableArea);
            
            // Get color and draw (reuse existing drawing logic below)
            const colorIndex = index % remainingColors.length;
            const remainingColor = remainingColors[colorIndex];
            const remainingBorderColor = remainingBorderColors[colorIndex];
            
            const isHovered = hoveredArea && hoveredArea.remainingStone.id === remainingStone.id;
            const isFocused = focusedPieceIndex !== null && 
              clickableAreasRef.current.length > focusedPieceIndex &&
              clickableAreasRef.current[focusedPieceIndex]?.remainingStone.id === remainingStone.id;
            const isHighlighted = isHovered || isFocused;
            
            const displayColor = isHighlighted ? (isDarkMode ? 'rgba(34, 197, 94, 0.7)' : 'rgba(34, 197, 94, 0.6)') : remainingColor;
            const displayBorderColor = isHighlighted ? (isDarkMode ? 'rgba(34, 197, 94, 0.9)' : 'rgba(34, 197, 94, 0.8)') : remainingBorderColor;
            const displayBorderWidth = isHighlighted ? 3 : 2;
            
            ctx.save();
            ctx.globalAlpha = animationProgress;
            
            ctx.fillStyle = displayColor;
            ctx.fillRect(clampedX, clampedY, clampedWidth, clampedHeight);
            
            ctx.strokeStyle = displayBorderColor;
            ctx.lineWidth = displayBorderWidth;
            ctx.strokeRect(clampedX, clampedY, clampedWidth, clampedHeight);
            
            if (isHighlighted) {
              ctx.shadowColor = isDarkMode ? 'rgba(34, 197, 94, 0.5)' : 'rgba(34, 197, 94, 0.4)';
              ctx.shadowBlur = 8;
              ctx.strokeStyle = displayBorderColor;
              ctx.lineWidth = displayBorderWidth;
              ctx.strokeRect(clampedX, clampedY, clampedWidth, clampedHeight);
              
              if (isFocused) {
                ctx.save();
                ctx.setLineDash([4, 4]);
                ctx.strokeStyle = isDarkMode ? 'rgba(59, 130, 246, 0.8)' : 'rgba(59, 130, 246, 0.7)';
                ctx.lineWidth = 2;
                ctx.strokeRect(clampedX - 2, clampedY - 2, clampedWidth + 4, clampedHeight + 4);
                ctx.restore();
              }
            }
            
            ctx.restore();
            
            // Add dot pattern
            ctx.save();
            ctx.globalAlpha = 0.3 * animationProgress;
            ctx.fillStyle = remainingBorderColor;
            const dotSpacing = 4;
            for (let y = clampedY + dotSpacing; y < clampedY + clampedHeight; y += dotSpacing * 2) {
              for (let x = clampedX + dotSpacing; x < clampedX + clampedWidth; x += dotSpacing * 2) {
                ctx.beginPath();
                ctx.arc(x, y, 1, 0, Math.PI * 2);
                ctx.fill();
              }
            }
            ctx.restore();
            
            // Draw label if large enough
            if (clampedWidth > 40 && clampedHeight > 40) {
              const lengthDisplay = remainingStone.id === 'primary-remaining' 
                ? `${formatDisplayNumber(stoneLengthInMeters)}m`
                : `${formatDisplayNumber(remainingStone.length)}cm`;
              const widthDisplay = `${formatDisplayNumber(widthToUse)}cm`;
              const remainingLabel = `باقی‌مانده ${index + 1}: ${lengthDisplay} × ${widthDisplay}`;
              const labelFontSize = Math.min(10, Math.min(clampedWidth, clampedHeight) / 12);
              
              if (labelFontSize >= 8) {
                const labelX = clampedX + clampedWidth / 2;
                const labelY = clampedY + clampedHeight / 2;
                const labelBgColor = remainingColors[colorIndex];
                const labelTextColor = '#ffffff';
                
                drawLabelWithBackground(
                  remainingLabel,
                  labelX,
                  labelY,
                  labelFontSize,
                  labelTextColor,
                  labelBgColor,
                  'center',
                  'middle'
                );
              }
            }
            
            return; // Skip standard drawing logic for layers
          } else {
            // Standard clamping for non-layer products
            clampedY = Math.max(remainingRect.y, originalRect.y);
          }
          
          const clampedWidth = Math.min(
            remainingRect.x + remainingRect.width - clampedX,
            originalRect.x + originalRect.width - clampedX
          );
          const clampedHeight = Math.min(
            remainingRect.y + remainingRect.height - clampedY,
            originalRect.y + originalRect.height - clampedY
          );

          // Skip if clamped dimensions are invalid
          if (clampedWidth <= 0 || clampedHeight <= 0) {
            return;
          }

          // === Phase 2: Track clickable areas for hit detection ===
          // Store this remaining piece as a clickable area (use clamped coordinates for accurate hit detection)
          // Note: Coordinates are in CSS pixels (already accounting for DPR in canvas rendering)
          const clickableArea: ClickableArea = {
            x: clampedX,
            y: clampedY,
            width: clampedWidth,
            height: clampedHeight,
            remainingStone: remainingStone,
            rect: {
              x: clampedX,
              y: clampedY,
              width: clampedWidth,
              height: clampedHeight
            }
          };
          
          clickableAreasRef.current.push(clickableArea);

          // Get color for this remaining piece (cycle through palette)
          const colorIndex = index % remainingColors.length;
          const remainingColor = remainingColors[colorIndex];
          const remainingBorderColor = remainingBorderColors[colorIndex];
          
          // === Phase 2: Highlight hovered/focused area ===
          const isHovered = hoveredArea && hoveredArea.remainingStone.id === remainingStone.id;
          const isFocused = focusedPieceIndex !== null && 
            clickableAreasRef.current.length > focusedPieceIndex &&
            clickableAreasRef.current[focusedPieceIndex]?.remainingStone.id === remainingStone.id;
          const isHighlighted = isHovered || isFocused;
          
          const displayColor = isHighlighted ? (isDarkMode ? 'rgba(34, 197, 94, 0.7)' : 'rgba(34, 197, 94, 0.6)') : remainingColor;
          const displayBorderColor = isHighlighted ? (isDarkMode ? 'rgba(34, 197, 94, 0.9)' : 'rgba(34, 197, 94, 0.8)') : remainingBorderColor;
          const displayBorderWidth = isHighlighted ? 3 : 2;
          
          // === Phase 3, Task 3: Apply fade-in animation ===
          // Apply animation progress to opacity for smooth fade-in
          ctx.save();
          ctx.globalAlpha = animationProgress;

          // Draw remaining stone rectangle with distinct color (highlighted if hovered)
          ctx.fillStyle = displayColor;
          ctx.fillRect(clampedX, clampedY, clampedWidth, clampedHeight);
          
          // Draw border around remaining piece (thicker if hovered)
          ctx.strokeStyle = displayBorderColor;
          ctx.lineWidth = displayBorderWidth;
          ctx.strokeRect(clampedX, clampedY, clampedWidth, clampedHeight);
          
          // If hovered or focused, add a subtle glow effect
          if (isHighlighted) {
            ctx.shadowColor = isDarkMode ? 'rgba(34, 197, 94, 0.5)' : 'rgba(34, 197, 94, 0.4)';
            ctx.shadowBlur = 8;
            ctx.strokeStyle = displayBorderColor;
            ctx.lineWidth = displayBorderWidth;
            ctx.strokeRect(clampedX, clampedY, clampedWidth, clampedHeight);
            
            // === Phase 4, Task 2: Add focus indicator for keyboard navigation ===
            if (isFocused) {
              // Draw a dashed border to indicate keyboard focus
              ctx.save();
              ctx.setLineDash([4, 4]);
              ctx.strokeStyle = isDarkMode ? 'rgba(59, 130, 246, 0.8)' : 'rgba(59, 130, 246, 0.7)'; // blue-500
              ctx.lineWidth = 2;
              ctx.strokeRect(clampedX - 2, clampedY - 2, clampedWidth + 4, clampedHeight + 4);
              ctx.restore();
            }
          }
          
          ctx.restore(); // Restore alpha
          
          // Add subtle pattern to distinguish from used areas
          // Use a dot pattern or grid pattern
          ctx.save();
          ctx.globalAlpha = 0.3 * animationProgress; // Apply animation to pattern too
          ctx.fillStyle = remainingBorderColor;
          
          // Draw a subtle dot grid pattern
          const dotSpacing = 4;
          for (let y = clampedY + dotSpacing; y < clampedY + clampedHeight; y += dotSpacing * 2) {
            for (let x = clampedX + dotSpacing; x < clampedX + clampedWidth; x += dotSpacing * 2) {
              ctx.beginPath();
              ctx.arc(x, y, 1, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          
          ctx.restore();
        }
      });
    }

    // === Phase 1, Task 7: Add Labels and Dimension Text Overlay ===
    
    // Helper function to draw text with background for better readability
    const drawLabelWithBackground = (
      text: string,
      x: number,
      y: number,
      fontSize: number,
      textColor: string,
      bgColor: string,
      textAlign: 'left' | 'center' | 'right' = 'center',
      textBaseline: 'top' | 'middle' | 'bottom' = 'middle'
    ) => {
      ctx.save();
      
      // Set font and text properties
      ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = textAlign;
      ctx.textBaseline = textBaseline;
      
      // Measure text
      const metrics = ctx.measureText(text);
      const textWidth = metrics.width;
      const textHeight = fontSize;
      const padding = 4;
      
      // Calculate background rectangle position based on alignment
      let bgX = x;
      if (textAlign === 'center') {
        bgX = x - textWidth / 2 - padding;
      } else if (textAlign === 'right') {
        bgX = x - textWidth - padding;
      } else {
        bgX = x - padding;
      }
      
      let bgY = y;
      if (textBaseline === 'middle') {
        bgY = y - textHeight / 2 - padding;
      } else if (textBaseline === 'bottom') {
        bgY = y - textHeight - padding;
      } else {
        bgY = y - padding;
      }
      
      // Draw background rectangle
      ctx.fillStyle = bgColor;
      ctx.fillRect(
        bgX,
        bgY,
        textWidth + padding * 2,
        textHeight + padding * 2
      );
      
      // Draw text
      ctx.fillStyle = textColor;
      ctx.fillText(text, x, y);
      
      ctx.restore();
    };
    
    // Determine minimum size for displaying labels (only show if section is large enough)
    const minSizeForLabel = 40; // pixels
    
    // 1. Label for original stone (if large enough and no cut, or show as border label when cut)
    // When there's a cut, don't show the original stone label in the center (it's confusing)
    // Instead, show it as a subtle border label if space allows
    // Convention: Always display dimensions as length � width
    if (!isCut && originalRect.width > minSizeForLabel && originalRect.height > minSizeForLabel) {
      const originalLabel = `${formatDisplayNumber(originalLengthInMeters)}m � ${formatDisplayNumber(originalWidthInCm)}cm`;
      const labelFontSize = Math.min(11, Math.min(originalRect.width, originalRect.height) / 10);
      
      if (labelFontSize >= 8) { // Only draw if font size is readable
        const labelX = originalRect.x + originalRect.width / 2;
        const labelY = originalRect.y + originalRect.height / 2;
        const labelBgColor = isDarkMode ? 'rgba(30, 41, 59, 0.85)' : 'rgba(248, 250, 252, 0.85)'; // slate-800/50 (with transparency)
        const labelTextColor = isDarkMode ? '#e2e8f0' : '#1e293b'; // slate-200 : slate-800
        
        drawLabelWithBackground(
          originalLabel,
          labelX,
          labelY,
          labelFontSize,
          labelTextColor,
          labelBgColor,
          'center',
          'middle'
        );
      }
    } else if (isCut) {
      // When there's a cut, show a subtle label in the top-left corner for the original dimensions
      // Convention: Always display dimensions as length � width
      // ðŸŽ¯ ENHANCEMENT: Add "(از باقی‌مانده)" suffix for layers cut from remaining stones
      const baseLabel = `اصلی: ${formatDisplayNumber(originalLengthInMeters)}m × ${formatDisplayNumber(originalWidthInCm)}cm`;
      const originalLabel = isLayerFromRemaining 
        ? `${baseLabel} (از باقی‌مانده)`
        : baseLabel;
      const labelFontSize = 9;
      const labelX = originalRect.x + 10;
      const labelY = originalRect.y + 15;
      const labelBgColor = isDarkMode ? 'rgba(30, 41, 59, 0.7)' : 'rgba(248, 250, 252, 0.7)';
      const labelTextColor = isDarkMode ? '#cbd5e1' : '#475569';
      
      drawLabelWithBackground(
        originalLabel,
        labelX,
        labelY,
        labelFontSize,
        labelTextColor,
        labelBgColor,
        'left',
        'top'
      );
    }
    
    // 2. Label for used area (if large enough)
    if (totalUsedLengthInMeters > 0 || totalUsedWidthInCm > 0) {
      const clampedUsedLength = Math.min(totalUsedLengthInMeters, originalLengthInMeters);
      const clampedUsedWidth = Math.min(totalUsedWidthInCm, originalWidthInCm);
      const usedRect: CanvasRect = realToCanvasRect(
        0,
        clampedUsedLength,
        0,
        clampedUsedWidth,
        originalLengthInMeters,
        originalWidthInCm,
        canvasWidth,
        canvasHeight,
        padding
      );
      
      // Recalculate usedRect for label positioning (same as drawing section)
      const usedRectForLabel: CanvasRect = realToCanvasRect(
        0,
        clampedUsedLength,
        0,
        clampedUsedWidth,
        originalLengthInMeters,
        originalWidthInCm,
        canvasWidth,
        canvasHeight,
        padding
      );
      
      // Clamp used rectangle to original stone bounds (same as drawing section)
      const clampedXForLabel = Math.max(usedRectForLabel.x, originalRect.x);
      const clampedYForLabel = Math.max(usedRectForLabel.y, originalRect.y);
      const clampedWidthForLabel = Math.min(
        usedRectForLabel.x + usedRectForLabel.width - clampedXForLabel,
        originalRect.x + originalRect.width - clampedXForLabel
      );
      const clampedHeightForLabel = Math.min(
        usedRectForLabel.y + usedRectForLabel.height - clampedYForLabel,
        originalRect.y + originalRect.height - clampedYForLabel
      );
      
      if (clampedWidthForLabel > minSizeForLabel && clampedHeightForLabel > minSizeForLabel) {
        // Convention: Always display dimensions as length � width
        const usedLabel = `استفاده شده: ${formatDisplayNumber(clampedUsedLength)}m × ${formatDisplayNumber(clampedUsedWidth)}cm`;
        const labelFontSize = Math.min(10, Math.min(clampedWidthForLabel, clampedHeightForLabel) / 12);
        
        if (labelFontSize >= 8) {
          const labelX = clampedXForLabel + clampedWidthForLabel / 2;
          const labelY = clampedYForLabel + clampedHeightForLabel / 2;
          const labelBgColor = isDarkMode ? 'rgba(239, 68, 68, 0.85)' : 'rgba(249, 115, 22, 0.85)'; // red/orange with transparency
          const labelTextColor = '#ffffff'; // white text for contrast
          
          drawLabelWithBackground(
            usedLabel,
            labelX,
            labelY,
            labelFontSize,
            labelTextColor,
            labelBgColor,
            'center',
            'middle'
          );
        }
      }
    }
    
    // 3. Labels for remaining pieces (if large enough)
    // Use the same allRemainingPieces array we created earlier
    if (allRemainingPieces && allRemainingPieces.length > 0) {
      allRemainingPieces.forEach((remainingStone, index) => {
        if (!remainingStone.isAvailable || remainingStone.length <= 0 || remainingStone.width <= 0) {
          return;
        }
        
        // Calculate position same as in drawing section
        let remainingStartLength: number;
        let remainingStartWidth: number;
        let stoneLengthInMeters: number;
        
        if (remainingStone.id === 'primary-remaining') {
          remainingStartLength = 0;
          remainingStartWidth = initialCutWidth;
          stoneLengthInMeters = remainingStone.length;
        } else if (remainingStone.position) {
          // Use explicit position for partitions
          remainingStartLength = remainingStone.position.startLength;
          remainingStartWidth = remainingStone.position.startWidth;
          stoneLengthInMeters = remainingStone.length > 100 ? remainingStone.length / 100 : remainingStone.length;
        } else {
          // Sequential positioning for legacy remaining stones
          remainingStartLength = totalUsedLengthInMeters;
          remainingStartWidth = totalUsedWidthInCm;
          stoneLengthInMeters = remainingStone.length > 100 ? remainingStone.length / 100 : remainingStone.length;
        }
        
        const remainingRect: CanvasRect = realToCanvasRect(
          remainingStartLength,
          stoneLengthInMeters,
          remainingStartWidth,
          remainingStone.width,
          originalLengthInMeters,
          originalWidthInCm,
          canvasWidth,
          canvasHeight,
          padding
        );
        
        // Use clamped coordinates if we calculated them earlier
        if (remainingRect.width > 0 && remainingRect.height > 0) {
          const clampedX = Math.max(remainingRect.x, originalRect.x);
          const clampedY = Math.max(remainingRect.y, originalRect.y);
          const clampedWidth = Math.min(
            remainingRect.x + remainingRect.width - clampedX,
            originalRect.x + originalRect.width - clampedX
          );
          const clampedHeight = Math.min(
            remainingRect.y + remainingRect.height - clampedY,
            originalRect.y + originalRect.height - clampedY
          );
          
          if (clampedWidth > minSizeForLabel && clampedHeight > minSizeForLabel) {
            // Format remaining stone dimensions based on type
            // Convention: Always display dimensions as length � width
            const lengthDisplay = remainingStone.id === 'primary-remaining' 
              ? `${formatDisplayNumber(stoneLengthInMeters)}m`
              : `${formatDisplayNumber(remainingStone.length)}cm`;
            const widthDisplay = `${formatDisplayNumber(remainingStone.width)}cm`;
            const remainingLabel = `باقی‌مانده ${index + 1}: ${lengthDisplay} × ${widthDisplay}`;
            const labelFontSize = Math.min(10, Math.min(clampedWidth, clampedHeight) / 12);
            
            if (labelFontSize >= 8) {
              const labelX = clampedX + clampedWidth / 2;
              const labelY = clampedY + clampedHeight / 2;
              
              // Get matching color for this remaining piece
              const remainingColors = isDarkMode ? [
                'rgba(34, 197, 94, 0.85)',   // green-500
                'rgba(59, 130, 246, 0.85)',  // blue-500
                'rgba(20, 184, 166, 0.85)',  // teal-500
                'rgba(168, 85, 247, 0.85)',  // purple-500
                'rgba(236, 72, 153, 0.85)',  // pink-500
                'rgba(251, 146, 60, 0.85)',  // orange-500
              ] : [
                'rgba(34, 197, 94, 0.85)',   // green-500
                'rgba(59, 130, 246, 0.85)',  // blue-500
                'rgba(20, 184, 166, 0.85)',  // teal-500
                'rgba(168, 85, 247, 0.85)',  // purple-500
                'rgba(236, 72, 153, 0.85)',  // pink-500
                'rgba(251, 146, 60, 0.85)',  // orange-500
              ];
              
              const colorIndex = index % remainingColors.length;
              const labelBgColor = remainingColors[colorIndex];
              const labelTextColor = '#ffffff'; // white text for contrast
              
              drawLabelWithBackground(
                remainingLabel,
                labelX,
                labelY,
                labelFontSize,
                labelTextColor,
                labelBgColor,
                'center',
                'middle'
              );
            }
          }
        }
      });
    }

  }, [canvasSize, originalLengthInMeters, originalWidthInCm, totalUsedLengthInMeters, totalUsedWidthInCm, remainingStones, stoneAspectRatio, isCut, initialCutLength, initialCutWidth, hoveredArea, appliedSubServices, animationProgress, focusedPieceIndex]);

  // === Phase 3, Task 3: Animation Logic ===
  // Detect changes in remaining pieces count and trigger fade-in animation
  useEffect(() => {
    const hasPrimaryRemaining = isCut && initialCutWidth > 0 && remainingWidthInCm > 0;
    const currentRemainingCount = (remainingStones?.length || 0) + (hasPrimaryRemaining ? 1 : 0);
    
    if (currentRemainingCount !== previousRemainingCountRef.current && currentRemainingCount > previousRemainingCountRef.current) {
      // New remaining piece added - trigger fade-in animation
      animationStartTimeRef.current = performance.now();
      setAnimationProgress(0);
      
      const animate = (currentTime: number) => {
        if (!animationStartTimeRef.current) return;
        
        const elapsed = currentTime - animationStartTimeRef.current;
        const duration = 500; // 500ms animation duration
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease-out cubic function for smooth animation
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        setAnimationProgress(easedProgress);
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setAnimationProgress(1);
          animationStartTimeRef.current = null;
        }
      };
      
      requestAnimationFrame(animate);
    } else if (currentRemainingCount <= previousRemainingCountRef.current) {
      // Piece removed or count decreased - reset animation
      setAnimationProgress(1);
      animationStartTimeRef.current = null;
    }
    
    previousRemainingCountRef.current = currentRemainingCount;
  }, [remainingStones, isCut, initialCutWidth, remainingWidthInCm]);

  // === Phase 4, Task 4: Load collapsed state from localStorage ===
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedState = localStorage.getItem('stoneCanvasCollapsed');
      if (savedState !== null) {
        setIsCollapsed(JSON.parse(savedState));
      }
    }
  }, []);

  // === Phase 4, Task 4: Save collapsed state to localStorage ===
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('stoneCanvasCollapsed', JSON.stringify(isCollapsed));
    }
  }, [isCollapsed]);

  // === Phase 2: Handle mouse/touch events for hit detection ===
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // === Phase 4, Task 1: Ignore mouse events if touch was recent (within 300ms) ===
    if (Date.now() - lastTouchTimeRef.current < 300) {
      return; // Ignore mouse events shortly after touch events
    }
    
    if (!interactive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // Get canvas coordinates in CSS pixels (matching the rendered rectangles)
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Find which area is being hovered
    const clickedArea = getClickedArea(canvasX, canvasY);
    
    if (clickedArea) {
      setHoveredArea(clickedArea);
      // Set tooltip position relative to page
      setTooltipPosition({
        x: e.clientX,
        y: e.clientY - 10 // Offset above cursor
      });
    } else {
      setHoveredArea(null);
      setTooltipPosition(null);
    }
  }, [interactive, getClickedArea]);

  const handleMouseLeave = useCallback(() => {
    setHoveredArea(null);
    setTooltipPosition(null);
  }, []);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // === Phase 4, Task 1: Ignore mouse click if touch was recent ===
    if (Date.now() - lastTouchTimeRef.current < 300) {
      return;
    }
    
    if (!interactive || !onPieceClick || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    // Get canvas coordinates in CSS pixels (matching the rendered rectangles)
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Find which area was clicked
    const clickedArea = getClickedArea(canvasX, canvasY);
    
    if (clickedArea && clickedArea.remainingStone.isAvailable) {
      // Call the callback with the clicked remaining stone
      onPieceClick(clickedArea.remainingStone);
    }
  }, [interactive, onPieceClick, getClickedArea]);

  // === Phase 4, Task 1: Touch event handlers ===
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!interactive || !canvasRef.current) return;
    
    lastTouchTimeRef.current = Date.now();
    
    // Prevent default touch behaviors (scroll, zoom, etc.)
    e.preventDefault();
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0]; // Get first touch point
    
    // Get canvas coordinates in CSS pixels
    const canvasX = touch.clientX - rect.left;
    const canvasY = touch.clientY - rect.top;
    
    // Find which area is being touched (similar to hover)
    const clickedArea = getClickedArea(canvasX, canvasY);
    
    if (clickedArea) {
      setHoveredArea(clickedArea);
      // Set tooltip position relative to page
      setTooltipPosition({
        x: touch.clientX,
        y: touch.clientY - 10 // Offset above touch point
      });
    } else {
      setHoveredArea(null);
      setTooltipPosition(null);
    }
  }, [interactive, getClickedArea]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!interactive || !canvasRef.current) return;
    
    // Prevent default touch behaviors
    e.preventDefault();
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    
    const canvasX = touch.clientX - rect.left;
    const canvasY = touch.clientY - rect.top;
    
    // Update hover area as finger moves
    const clickedArea = getClickedArea(canvasX, canvasY);
    
    if (clickedArea) {
      setHoveredArea(clickedArea);
      setTooltipPosition({
        x: touch.clientX,
        y: touch.clientY - 10
      });
    } else {
      setHoveredArea(null);
      setTooltipPosition(null);
    }
  }, [interactive, getClickedArea]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!interactive || !onPieceClick || !canvasRef.current) return;
    
    // Prevent default touch behaviors
    e.preventDefault();
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Use the last touch point (if available) or changed touches
    const touch = e.changedTouches[0] || (e.touches.length > 0 ? e.touches[0] : null);
    if (!touch) return;
    
    const canvasX = touch.clientX - rect.left;
    const canvasY = touch.clientY - rect.top;
    
    // Find which area was touched
    const clickedArea = getClickedArea(canvasX, canvasY);
    
    if (clickedArea && clickedArea.remainingStone.isAvailable) {
      // Call the callback with the clicked remaining stone
      onPieceClick(clickedArea.remainingStone);
    }
    
    // Clear hover state after a short delay to allow tooltip to be visible
    setTimeout(() => {
      setHoveredArea(null);
      setTooltipPosition(null);
    }, 200);
  }, [interactive, onPieceClick, getClickedArea]);

  const handleTouchCancel = useCallback(() => {
    // Clear hover state if touch is cancelled
    setHoveredArea(null);
    setTooltipPosition(null);
  }, []);

  // === Phase 4, Task 2: Keyboard navigation ===
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!interactive || !canvasRef.current) return;
    
    const areas = clickableAreasRef.current.filter(area => area.remainingStone.isAvailable);
    if (areas.length === 0) return;
    
    const currentIndex = focusedPieceIndex !== null && focusedPieceIndex < areas.length 
      ? focusedPieceIndex 
      : -1;
    
    let newIndex = currentIndex;
    
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        // Navigate to next piece
        e.preventDefault();
        newIndex = currentIndex < areas.length - 1 ? currentIndex + 1 : 0;
        setFocusedPieceIndex(newIndex);
        if (areas[newIndex]) {
          setHoveredArea(areas[newIndex]);
          // Position tooltip at center of focused piece
          const rect = canvasRef.current!.getBoundingClientRect();
          setTooltipPosition({
            x: rect.left + areas[newIndex].x + areas[newIndex].width / 2,
            y: rect.top + areas[newIndex].y - 10
          });
        }
        break;
        
      case 'ArrowLeft':
      case 'ArrowUp':
        // Navigate to previous piece
        e.preventDefault();
        newIndex = currentIndex > 0 ? currentIndex - 1 : areas.length - 1;
        setFocusedPieceIndex(newIndex);
        if (areas[newIndex]) {
          setHoveredArea(areas[newIndex]);
          const rect = canvasRef.current!.getBoundingClientRect();
          setTooltipPosition({
            x: rect.left + areas[newIndex].x + areas[newIndex].width / 2,
            y: rect.top + areas[newIndex].y - 10
          });
        }
        break;
        
      case 'Enter':
      case ' ':
        // Select focused piece
        e.preventDefault();
        if (currentIndex >= 0 && areas[currentIndex] && onPieceClick) {
          onPieceClick(areas[currentIndex].remainingStone);
        }
        break;
        
      case 'Escape':
        // Clear focus
        e.preventDefault();
        setFocusedPieceIndex(null);
        setHoveredArea(null);
        setTooltipPosition(null);
        break;
    }
  }, [interactive, focusedPieceIndex, onPieceClick]);

  // === Phase 4, Task 2: Reset focus when remaining pieces change ===
  useEffect(() => {
    // Reset focus index when clickable areas change
    setFocusedPieceIndex(null);
  }, [remainingStones, isCut]);

  // === Phase 4, Task 3: Generate accessible description ===
  const accessibleDescription = React.useMemo(() => {
    const hasPrimaryRemaining = isCut && initialCutWidth > 0 && remainingWidthInCm > 0;
    const remainingCount = (remainingStones?.length || 0) + (hasPrimaryRemaining ? 1 : 0);
    const usedArea = totalUsedLengthInMeters > 0 || totalUsedWidthInCm > 0;
    const subServicesCount = appliedSubServices?.length || 0;
    
    let description = `سنگ اصلی: ${formatDisplayNumber(originalLengthNum)}${lengthUnit} در ${formatDisplayNumber(originalWidthNum)}${widthUnit}`;
    
    if (usedArea) {
      description += `. منطقه استفاده شده نشان داده شده است`;
    }
    
    if (remainingCount > 0) {
      description += `. ${remainingCount} قطعه باقی‌مانده Ù…ÙˆØ¬Ùˆد است`;
    }
    
    if (subServicesCount > 0) {
      description += `. ${subServicesCount} ابزار اعمال شده است`;
    }
    
    if (interactive && remainingCount > 0) {
      description += `. برای انتخاب قطعه باقی‌مانده، از فلش‌های صفحه کلید استفاده کنید یا کلیک کنید`;
    }
    
    return description;
  }, [originalLengthNum, originalWidthNum, lengthUnit, widthUnit, isCut, initialCutWidth, remainingWidthInCm, remainingStones, totalUsedLengthInMeters, totalUsedWidthInCm, appliedSubServices, interactive]);

  // === Phase 4, Task 3: Screen reader announcement ===
  useEffect(() => {
    if (focusedPieceIndex !== null && clickableAreasRef.current[focusedPieceIndex]) {
      const piece = clickableAreasRef.current[focusedPieceIndex].remainingStone;
      const lengthDisplay = piece.id === 'primary-remaining' 
        ? `${formatDisplayNumber(piece.length)}m`
        : `${formatDisplayNumber(piece.length / 100)}m`;
      
      // Announce to screen readers
      const announcement = `قطعه باقی‌مانده انتخاب شده: Ø·Ùˆل ${lengthDisplay}، عرض ${formatDisplayNumber(piece.width)}cm، متر مربع ${formatDisplayNumber(piece.squareMeters)}`;
      
      // Create a temporary aria-live region for announcement
      const liveRegion = document.createElement('div');
      liveRegion.setAttribute('role', 'status');
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.style.cssText = 'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0;';
      liveRegion.textContent = announcement;
      document.body.appendChild(liveRegion);
      
      // Remove after announcement
      setTimeout(() => {
        document.body.removeChild(liveRegion);
      }, 1000);
    }
  }, [focusedPieceIndex]);

  return (
    <div 
      ref={containerRef}
      className={`w-full ${className}`}
    >
      {/* === Phase 4, Task 4: Collapsible header === */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'باز کردن نمایش بصری سنگ' : 'بستن نمایش بصری سنگ'}
        >
          <span className="font-medium">نمایش بصری سنگ</span>
          <svg
            className={`w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {/* === Phase 4, Task 4: Summary when collapsed === */}
        {isCollapsed && (
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {(() => {
              const hasPrimaryRemaining = isCut && initialCutWidth > 0 && remainingWidthInCm > 0;
              const remainingCount = (remainingStones?.length || 0) + (hasPrimaryRemaining ? 1 : 0);
              return remainingCount > 0 
                ? `${remainingCount} قطعه باقی‌مانده`
                : 'هیچ قطعه باقی‌مانده‌ای ÙˆØ¬Ùˆد ندارد';
            })()}
          </div>
        )}
      </div>
      
      {/* === Phase 4, Task 4: Collapsible content === */}
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          isCollapsed ? 'max-h-0 opacity-0' : 'max-h-[500px] opacity-100'
        }`}
      >
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          onKeyDown={handleKeyDown}
          tabIndex={interactive ? 0 : -1}
          className="block w-full border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          style={{
            cursor: interactive && hoveredArea ? 'pointer' : 'default',
            touchAction: 'none' // === Phase 4, Task 1: Prevent default touch behaviors ===
          }}
          role="img"
          aria-label={accessibleDescription}
          aria-describedby="stone-canvas-description"
        />
        
        {/* === Phase 4, Task 3: Hidden description for screen readers === */}
        <div 
          id="stone-canvas-description" 
          className="absolute w-px h-px -m-px overflow-hidden"
          style={{ clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', borderWidth: 0 }}
          aria-hidden="true"
        >
          {accessibleDescription}
        </div>
      </div>
      
      {/* === Phase 2: Tooltip === */}
      {interactive && tooltipPosition && hoveredArea && (
        <div
          className="fixed z-50 px-3 py-2 bg-slate-800 dark:bg-slate-900 text-white text-xs rounded-lg shadow-lg pointer-events-none"
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <div className="font-semibold mb-1">باقی‌مانده</div>
          <div>طول: {formatDisplayNumber(hoveredArea.remainingStone.id === 'primary-remaining' ? hoveredArea.remainingStone.length : hoveredArea.remainingStone.length / 100)}m</div>
          <div>عرض: {formatDisplayNumber(hoveredArea.remainingStone.width)}cm</div>
          <div>متر مربع: {formatDisplayNumber(hoveredArea.remainingStone.squareMeters)}</div>
          <div className="mt-1 pt-1 border-t border-slate-700 text-slate-300">
            کلیک کنید برای استفاده
          </div>
        </div>
      )}
      
      {/* === Phase 3, Task 2: Sub-Service Legend === */}
      {appliedSubServices && appliedSubServices.length > 0 && (
        <div className="mt-2 p-2 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
            راهنمای ابزارها:
          </div>
          <div className="grid grid-cols-2 gap-2">
            {appliedSubServices.map((applied, index) => {
              const patternColor = getSubServicePatternColor(index, window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
              const borderColor = getSubServiceBorderColor(index, window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
              
              return (
                <div key={applied.id} className="flex items-center gap-2 text-xs">
                  <div
                    className="w-4 h-4 rounded border flex-shrink-0"
                    style={{
                      backgroundColor: patternColor.fill,
                      borderColor: borderColor,
                      position: 'relative'
                    }}
                  >
                    {/* Mini pattern preview */}
                    <svg width="16" height="16" className="absolute inset-0 pointer-events-none">
                      <defs>
                        <pattern
                          id={`pattern-${index}`}
                          patternUnits="userSpaceOnUse"
                          width="6"
                          height="6"
                        >
                          {patternColor.pattern === 'vertical' && (
                            <line x1="3" y1="0" x2="3" y2="6" stroke={borderColor} strokeWidth="1" />
                          )}
                          {patternColor.pattern === 'horizontal' && (
                            <line x1="0" y1="3" x2="6" y2="3" stroke={borderColor} strokeWidth="1" />
                          )}
                          {patternColor.pattern === 'diagonal' && (
                            <line x1="0" y1="0" x2="6" y2="6" stroke={borderColor} strokeWidth="1" />
                          )}
                          {patternColor.pattern === 'cross' && (
                            <>
                              <line x1="0" y1="0" x2="6" y2="6" stroke={borderColor} strokeWidth="1" />
                              <line x1="6" y1="0" x2="0" y2="6" stroke={borderColor} strokeWidth="1" />
                            </>
                          )}
                          {patternColor.pattern === 'dots' && (
                            <circle cx="3" cy="3" r="1" fill={borderColor} />
                          )}
                          {patternColor.pattern === 'grid' && (
                            <>
                              <line x1="3" y1="0" x2="3" y2="6" stroke={borderColor} strokeWidth="1" />
                              <line x1="0" y1="3" x2="6" y2="3" stroke={borderColor} strokeWidth="1" />
                            </>
                          )}
                        </pattern>
                      </defs>
                      <rect width="16" height="16" fill={`url(#pattern-${index})`} />
                    </svg>
                  </div>
                  <span className="text-slate-600 dark:text-slate-400 truncate">
                    {applied.subService.namePersian}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default StoneCanvas;

