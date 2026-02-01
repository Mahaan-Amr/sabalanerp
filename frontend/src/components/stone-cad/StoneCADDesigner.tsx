'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Stage, Layer, Group, Rect, Text, Line, Circle } from 'react-konva';
// SlabStandardDimensionEntry type definition (matches the one in page.tsx)
interface SlabStandardDimensionEntry {
  id: string;
  standardLengthCm: number;
  standardWidthCm: number;
  quantity: number;
}
import { CoordinateSystem } from './types/CADTypes';
import { initializeCoordinateSystem, realToCanvas, canvasToReal } from './utils/coordinateUtils';
import { useCADState } from './hooks/useCADState';
import { GridManager } from './managers/GridManager';
import { BaseTool, ToolContext } from './tools/BaseTool';
import { RectangleTool } from './tools/RectangleTool';
import { MeasurementTool } from './tools/MeasurementTool';
import { SelectTool } from './tools/SelectTool';
import { CircleTool } from './tools/CircleTool';
import { LineTool } from './tools/LineTool';
import { FreehandTool } from './tools/FreehandTool';
import { TextTool } from './tools/TextTool';
import { CADToolbar } from './CADToolbar';
import { CADLayersPanel } from './CADLayersPanel';
import { extractDimensionsFromDesign } from './utils/costCalculationUtils';
import { exportToPNG, exportToSVG, downloadSVG, exportToJSON, downloadJSON } from './utils/exportUtils';

interface StoneCADDesignerProps {
  originalLength: number;
  originalWidth: number;
  lengthUnit: 'cm' | 'm';
  widthUnit: 'cm' | 'm';
  standardDimensions?: SlabStandardDimensionEntry[];
  productType: 'longitudinal' | 'slab';
  mode?: 'design' | 'view';
  onDesignChange?: (design: any) => void;
  onDimensionsCalculated?: (dimensions: { length?: number; width?: number; squareMeters?: number }) => void;
  onCostCalculated?: (cost: number) => void;
  initialDesign?: any;
  enableCostCalculation?: boolean;
  enableAutoSync?: boolean;
  enableExport?: boolean;
}

export function StoneCADDesigner({
  originalLength,
  originalWidth,
  lengthUnit,
  widthUnit,
  standardDimensions,
  productType,
  mode = 'design',
  onDesignChange,
  onDimensionsCalculated,
  onCostCalculated,
  initialDesign,
  enableCostCalculation = true,
  enableAutoSync = false,
  enableExport = true
}: StoneCADDesignerProps) {
  const stageRef = useRef<any>(null);
  const drawingLayerRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [coordSystem, setCoordSystem] = useState<CoordinateSystem | null>(null);
  
  // CAD State Management
  const {
    state: cadState,
    addShape,
    addMeasurement,
    setSelectedTool,
    toggleGrid,
    toggleSnap,
    undo,
    redo,
    canUndo,
    canRedo,
    setState: updateCADState,
    addLayer,
    updateLayer,
    deleteLayer,
    setActiveLayer
  } = useCADState(initialDesign);
  
  // Layers panel visibility state
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  
  // Extract dimensions when shapes change
  useEffect(() => {
    if (enableAutoSync && cadState.shapes.length > 0) {
      const extracted = extractDimensionsFromDesign(cadState, productType);
      if (extracted.length && extracted.width && onDimensionsCalculated) {
        onDimensionsCalculated({
          length: extracted.length,
          width: extracted.width,
          squareMeters: extracted.squareMeters
        });
      }
    }
    
    // Trigger design change callback
    if (onDesignChange) {
      onDesignChange({
        shapes: cadState.shapes,
        measurements: cadState.measurements,
        layers: cadState.layers,
        version: cadState.version
      });
    }
  }, [cadState.shapes, cadState.measurements, enableAutoSync, productType, onDimensionsCalculated, onDesignChange]);
  
  // Grid Manager
  const gridManager = useMemo(() => {
    const manager = new GridManager(cadState.gridSize);
    manager.setVisible(cadState.gridVisible);
    manager.setSnapEnabled(cadState.snapEnabled);
    return manager;
  }, [cadState.gridVisible, cadState.gridSize, cadState.snapEnabled]);
  
  // Tool instances
  const tools = useMemo(() => {
    return {
      select: new SelectTool(),
      rectangle: new RectangleTool(),
      measurement: new MeasurementTool(),
      circle: new CircleTool(),
      line: new LineTool(),
      freehand: new FreehandTool(),
      text: new TextTool()
    };
  }, []);
  
  // Current tool
  const currentTool = useMemo(() => {
    return tools[cadState.selectedTool as keyof typeof tools] || tools.select;
  }, [cadState.selectedTool, tools]);
  
  // Convert units to canvas coordinates (all in cm)
  const originalLengthCm = lengthUnit === 'm' ? originalLength * 100 : originalLength;
  const originalWidthCm = widthUnit === 'm' ? originalWidth * 100 : originalWidth;
  
  // Calculate canvas size based on stone dimensions
  useEffect(() => {
    const container = stageRef.current?.container();
    if (container) {
      const containerWidth = container.clientWidth || 800;
      
      if (productType === 'slab' && standardDimensions && standardDimensions.length > 0) {
        // For multiple stones, calculate total width needed
        const totalWidth = standardDimensions.reduce((sum, entry) => sum + entry.standardWidthCm, 0);
        const maxLength = Math.max(...standardDimensions.map(e => e.standardLengthCm * 100));
        const spacing = 50;
        const totalWidthWithSpacing = totalWidth + (spacing * (standardDimensions.length + 1));
        
        const aspectRatio = maxLength / totalWidthWithSpacing;
        const canvasHeight = containerWidth / aspectRatio;
        
        setDimensions({
          width: containerWidth,
          height: Math.max(canvasHeight, 400)
        });
      } else {
        // Single stone
        const aspectRatio = originalLengthCm / originalWidthCm;
        const canvasHeight = containerWidth / aspectRatio;
        
        setDimensions({
          width: containerWidth,
          height: Math.max(canvasHeight, 400)
        });
      }
    }
  }, [originalLengthCm, originalWidthCm, productType, standardDimensions]);
  
  // Initialize coordinate system
  useEffect(() => {
    if (dimensions.width > 0 && dimensions.height > 0 && coordSystem === null) {
      if (productType === 'slab' && standardDimensions && standardDimensions.length > 0) {
        // For slab, use first stone for coordinate system (will be adjusted per stone)
        const firstStone = standardDimensions[0];
        const system = initializeCoordinateSystem(
          firstStone.standardLengthCm * 100,
          firstStone.standardWidthCm,
          dimensions.width,
          dimensions.height
        );
        setCoordSystem(system);
      } else {
        const system = initializeCoordinateSystem(
          originalLengthCm,
          originalWidthCm,
          dimensions.width,
          dimensions.height
        );
        setCoordSystem(system);
      }
    }
  }, [dimensions, originalLengthCm, originalWidthCm, productType, standardDimensions, coordSystem]);
  
  // Handle mouse events
  const handleMouseDown = useCallback((e: any) => {
    if (!coordSystem || !drawingLayerRef.current || mode !== 'design') return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const toolContext: ToolContext = {
      stage,
      layer: drawingLayerRef.current,
      coordSystem,
      cadState,
      updateState: () => {}, // Not used in tools directly
      addShape,
      addMeasurement,
      gridManager,
      onDimensionsCalculated
    };
    
    currentTool.onMouseDown(e, toolContext);
  }, [coordSystem, cadState, currentTool, addShape, addMeasurement, gridManager, onDimensionsCalculated, mode]);
  
  const handleMouseMove = useCallback((e: any) => {
    if (!coordSystem || !drawingLayerRef.current || mode !== 'design') return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const toolContext: ToolContext = {
      stage,
      layer: drawingLayerRef.current,
      coordSystem,
      cadState,
      updateState: () => {},
      addShape,
      addMeasurement,
      gridManager,
      onDimensionsCalculated
    };
    
    currentTool.onMouseMove(e, toolContext);
  }, [coordSystem, cadState, currentTool, addShape, addMeasurement, gridManager, onDimensionsCalculated, mode]);
  
  const handleMouseUp = useCallback((e: any) => {
    if (!coordSystem || !drawingLayerRef.current || mode !== 'design') return;
    
    const stage = e.target.getStage();
    if (!stage) return;
    
    const toolContext: ToolContext = {
      stage,
      layer: drawingLayerRef.current,
      coordSystem,
      cadState,
      updateState: () => {},
      addShape,
      addMeasurement,
      gridManager,
      onDimensionsCalculated
    };
    
    currentTool.onMouseUp(e, toolContext);
  }, [coordSystem, cadState, currentTool, addShape, addMeasurement, gridManager, onDimensionsCalculated, mode]);
  
  // Render stone background(s)
  const renderStoneBackgrounds = () => {
    if (productType === 'slab' && standardDimensions && standardDimensions.length > 0) {
      // Multiple stones for slab
      const spacing = 50;
      let currentX = 50;
      
      return standardDimensions.map((entry, index) => {
        const stoneX = currentX;
        const stoneWidth = entry.standardWidthCm;
        const stoneHeight = entry.standardLengthCm * 100; // Convert to cm
        currentX += stoneWidth + spacing;
        
        return (
          <Group key={`stone-${entry.id}`} x={stoneX} y={50}>
            {/* Stone background */}
            <Rect
              width={stoneWidth}
              height={stoneHeight}
              fill="#e8e8e8"
              stroke="#333"
              strokeWidth={2}
              cornerRadius={4}
              listening={false}
            />
            
            {/* Stone label */}
            <Text
              text={`${entry.standardLengthCm}×${entry.standardWidthCm}cm`}
              x={10}
              y={10}
              fontSize={14}
              fill="#333"
              fontStyle="bold"
              listening={false}
            />
            
            {/* Quantity label */}
            <Text
              text={`تعداد: ${entry.quantity}`}
              x={10}
              y={30}
              fontSize={12}
              fill="#666"
              listening={false}
            />
          </Group>
        );
      });
    } else {
      // Single stone for longitudinal
      return (
        <Group x={50} y={50}>
          <Rect
            width={originalWidthCm}
            height={originalLengthCm}
            fill="#e8e8e8"
            stroke="#333"
            strokeWidth={2}
            cornerRadius={4}
            listening={false}
          />
          <Text
            text={`${originalLengthCm}×${originalWidthCm}cm`}
            x={10}
            y={10}
            fontSize={14}
            fill="#333"
            fontStyle="bold"
            listening={false}
          />
        </Group>
      );
    }
  };
  
  // Render grid
  const renderGrid = () => {
    if (!coordSystem || !cadState.gridVisible) return null;
    
    const gridLines = gridManager.getGridLines(dimensions.width, dimensions.height, coordSystem);
    return gridLines.map((line, index) => (
      <Line
        key={`grid-${index}`}
        points={line.points}
        stroke="#ddd"
        strokeWidth={1}
        listening={false}
        opacity={0.5}
      />
    ));
  };
  
  // Render shapes (filtered by layer visibility)
  const renderShapes = () => {
    if (!coordSystem) return null;
    
    // Get visible layers
    const visibleLayerIds = new Set(
      cadState.layers.filter(layer => layer.visible).map(layer => layer.id)
    );
    
    // Filter shapes by visible layers
    const visibleShapes = cadState.shapes.filter(shape =>
      visibleLayerIds.has(shape.layer)
    );
    
    return visibleShapes.map(shape => {
      const canvasPos = realToCanvas(shape.x, shape.y, coordSystem);
      
      // Check if shape's layer is locked
      const shapeLayer = cadState.layers.find(l => l.id === shape.layer);
      const isLocked = shapeLayer?.locked || false;
      
      switch (shape.type) {
        case 'rectangle':
          const canvasWidth = (shape.width || 0) * coordSystem.scale;
          const canvasHeight = (shape.height || 0) * coordSystem.scale;
          return (
            <Rect
              key={shape.id}
              x={canvasPos.x}
              y={canvasPos.y}
              width={canvasWidth}
              height={canvasHeight}
              fill={shape.fill || 'rgba(59, 130, 246, 0.2)'}
              stroke={shape.stroke || '#3b82f6'}
              strokeWidth={shape.strokeWidth || 2}
              draggable={
                cadState.selectedTool === 'select' &&
                cadState.selectedObjects.includes(shape.id) &&
                !isLocked
              }
              opacity={shapeLayer?.visible === false ? 0.3 : 1}
            />
          );
        case 'circle':
          if (shape.radius) {
            const canvasRadius = (shape.radius || 0) * coordSystem.scale;
            return (
              <Circle
                key={shape.id}
                x={canvasPos.x}
                y={canvasPos.y}
                radius={canvasRadius}
                fill={shape.fill || 'rgba(139, 92, 246, 0.2)'}
                stroke={shape.stroke || '#8b5cf6'}
                strokeWidth={shape.strokeWidth || 2}
                draggable={
                  cadState.selectedTool === 'select' &&
                  cadState.selectedObjects.includes(shape.id) &&
                  !isLocked
                }
                opacity={shapeLayer?.visible === false ? 0.3 : 1}
              />
            );
          }
          return null;
        case 'line':
          if (shape.points && shape.points.length >= 4) {
            // Convert real coordinates to canvas coordinates
            const canvasPoints: number[] = [];
            for (let i = 0; i < shape.points.length; i += 2) {
              const point = realToCanvas(shape.points[i], shape.points[i + 1], coordSystem);
              canvasPoints.push(point.x, point.y);
            }
            return (
              <Line
                key={shape.id}
                points={canvasPoints}
                stroke={shape.stroke || '#ef4444'}
                strokeWidth={shape.strokeWidth || 2}
                draggable={
                  cadState.selectedTool === 'select' &&
                  cadState.selectedObjects.includes(shape.id) &&
                  !isLocked
                }
                opacity={shapeLayer?.visible === false ? 0.3 : 1}
              />
            );
          }
          return null;
        case 'freehand':
          if (shape.points && shape.points.length >= 4) {
            // Convert real coordinates to canvas coordinates
            const canvasPoints: number[] = [];
            for (let i = 0; i < shape.points.length; i += 2) {
              const point = realToCanvas(shape.points[i], shape.points[i + 1], coordSystem);
              canvasPoints.push(point.x, point.y);
            }
            return (
              <Line
                key={shape.id}
                points={canvasPoints}
                stroke={shape.stroke || '#000000'}
                strokeWidth={shape.strokeWidth || 2}
                lineCap="round"
                lineJoin="round"
                tension={0.5}
                draggable={
                  cadState.selectedTool === 'select' &&
                  cadState.selectedObjects.includes(shape.id) &&
                  !isLocked
                }
                opacity={shapeLayer?.visible === false ? 0.3 : 1}
              />
            );
          }
          return null;
        case 'text':
          return (
            <Text
              key={shape.id}
              x={canvasPos.x}
              y={canvasPos.y}
              text={shape.text || 'متن'}
              fontSize={shape.fontSize || 16}
              fill={shape.fill || shape.stroke || '#000000'}
              fontFamily="Arial"
              draggable={
                cadState.selectedTool === 'select' &&
                cadState.selectedObjects.includes(shape.id) &&
                !isLocked
              }
              opacity={shapeLayer?.visible === false ? 0.3 : 1}
            />
          );
        default:
          return null;
      }
    });
  };
  
  // Render measurements
  const renderMeasurements = () => {
    return cadState.measurements.map(measurement => (
      <Group key={measurement.id}>
        <Line
          points={[measurement.startX, measurement.startY, measurement.endX, measurement.endY]}
          stroke="#10b981"
          strokeWidth={2}
          dash={[5, 5]}
          listening={false}
        />
        <Text
          text={`${measurement.distance.toFixed(1)} cm`}
          x={measurement.labelX}
          y={measurement.labelY}
          fontSize={12}
          fill="#10b981"
          backgroundColor="white"
          padding={4}
          listening={false}
        />
      </Group>
    ));
  };
  
  // Update cursor based on tool
  useEffect(() => {
    if (stageRef.current && mode === 'design') {
      const container = stageRef.current.container();
      if (container) {
        container.style.cursor = currentTool.getCursor();
      }
    }
  }, [currentTool, mode]);
  
  return (
    <div className="stone-cad-designer w-full">
      {mode === 'design' && (
        <>
          <CADToolbar
            selectedTool={cadState.selectedTool}
            onToolChange={setSelectedTool}
            gridVisible={cadState.gridVisible}
            onToggleGrid={toggleGrid}
            snapEnabled={cadState.snapEnabled}
            onToggleSnap={toggleSnap}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            onToggleLayers={() => setShowLayersPanel(!showLayersPanel)}
            showLayersPanel={showLayersPanel}
            onExport={enableExport ? (format) => {
              if (!stageRef.current || !coordSystem) return;
              
              const stage = stageRef.current;
              
              switch (format) {
                case 'png':
                  exportToPNG(stage, `cad-design-${Date.now()}.png`);
                  break;
                case 'svg':
                  const svgContent = exportToSVG(
                    cadState,
                    coordSystem,
                    dimensions.width,
                    dimensions.height
                  );
                  downloadSVG(svgContent, `cad-design-${Date.now()}.svg`);
                  break;
                case 'json':
                  const jsonContent = exportToJSON(cadState, {
                    productType,
                    stoneDimensions: {
                      length: originalLength,
                      width: originalWidth
                    }
                  });
                  downloadJSON(jsonContent, `cad-design-${Date.now()}.json`);
                  break;
              }
            } : undefined}
          />
          
          {showLayersPanel && (
            <div className="mt-2">
              <CADLayersPanel
                layers={cadState.layers}
                activeLayer={cadState.activeLayer}
                onLayerAdd={() => addLayer('')}
                onLayerUpdate={updateLayer}
                onLayerDelete={deleteLayer}
                onLayerSelect={setActiveLayer}
              />
            </div>
          )}
        </>
      )}
      
      <div className="cad-canvas-container border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
        <Stage
          ref={stageRef}
          width={dimensions.width}
          height={dimensions.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
        >
          {/* Background Layer */}
          <Layer>
            {renderGrid()}
            {renderStoneBackgrounds()}
          </Layer>
          
          {/* Drawing Layer */}
          <Layer ref={drawingLayerRef}>
            {renderShapes()}
            {renderMeasurements()}
          </Layer>
        </Stage>
      </div>
      
      {mode === 'design' && (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 text-center">
          ابزار فعال: {currentTool.displayName}
        </div>
      )}
    </div>
  );
}
