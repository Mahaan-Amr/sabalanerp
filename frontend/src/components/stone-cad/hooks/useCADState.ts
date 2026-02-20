/**
 * CAD State Management Hook
 * Manages the state of the CAD designer including shapes, measurements, layers, etc.
 */

import { useState, useCallback, useRef, useMemo } from 'react';
import { CADState, CADShape, Measurement, CADLayer } from '../types/CADTypes';

const DEFAULT_LAYER_ID = 'default-layer';

/**
 * Create initial CAD state
 */
function createInitialCADState(): CADState {
  const defaultLayer: CADLayer = {
    id: DEFAULT_LAYER_ID,
    name: '?? ??',
    visible: true,
    locked: false,
    order: 0
  };

  return {
    shapes: [],
    measurements: [],
    layers: [defaultLayer],
    selectedTool: 'select',
    selectedObjects: [],
    activeLayer: DEFAULT_LAYER_ID,
    gridVisible: true,
    gridSize: 10, // 10cm grid
    snapEnabled: true,
    showMeasurements: true,
    version: 1,
    lastModified: new Date()
  };
}

/**
 * Hook for managing CAD state
 */
export function useCADState(initialDesign?: any) {
  const initialState = useMemo(() => {
    if (initialDesign) {
      return deserializeCADDesign(initialDesign);
    }
    return createInitialCADState();
  }, [initialDesign]);
  
  const [state, setState] = useState<CADState>(initialState);

  const historyRef = useRef<CADState[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const maxHistory = 50;
  
  // Initialize history with initial state
  useMemo(() => {
    if (historyRef.current.length === 0) {
      historyRef.current = [JSON.parse(JSON.stringify(initialState))];
      historyIndexRef.current = 0;
      setHistoryState({ canUndo: false, canRedo: false });
    }
  }, []); // Only run once on mount

  /**
   * Update state with callback
   */
  const updateState = useCallback((updater: (prev: CADState) => CADState) => {
    setState(prev => {
      const newState = updater(prev);
      
      // Save to history
      if (historyIndexRef.current < historyRef.current.length - 1) {
        // Remove future history if we're not at the end
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      }
      
      historyRef.current.push(JSON.parse(JSON.stringify(newState))); // Deep clone
      historyIndexRef.current++;
      
      // Limit history size
      if (historyRef.current.length > maxHistory) {
        historyRef.current.shift();
        historyIndexRef.current--;
      }
      
      // Update history state
      setHistoryState({
        canUndo: historyIndexRef.current > 0,
        canRedo: historyIndexRef.current < historyRef.current.length - 1
      });
      
      return newState;
    });
  }, []);

  /**
   * Add a shape to the canvas
   */
  const addShape = useCallback((shape: CADShape) => {
    updateState(prev => ({
      ...prev,
      shapes: [...prev.shapes, shape],
      lastModified: new Date()
    }));
  }, [updateState]);

  /**
   * Update a shape
   */
  const updateShape = useCallback((id: string, updates: Partial<CADShape>) => {
    updateState(prev => ({
      ...prev,
      shapes: prev.shapes.map(s => 
        s.id === id ? { ...s, ...updates } : s
      ),
      lastModified: new Date()
    }));
  }, [updateState]);

  /**
   * Delete a shape
   */
  const deleteShape = useCallback((id: string) => {
    updateState(prev => ({
      ...prev,
      shapes: prev.shapes.filter(s => s.id !== id),
      selectedObjects: prev.selectedObjects.filter(objId => objId !== id),
      lastModified: new Date()
    }));
  }, [updateState]);

  /**
   * Add a measurement
   */
  const addMeasurement = useCallback((measurement: Measurement) => {
    updateState(prev => ({
      ...prev,
      measurements: [...prev.measurements, measurement],
      lastModified: new Date()
    }));
  }, [updateState]);

  /**
   * Delete a measurement
   */
  const deleteMeasurement = useCallback((id: string) => {
    updateState(prev => ({
      ...prev,
      measurements: prev.measurements.filter(m => m.id !== id),
      lastModified: new Date()
    }));
  }, [updateState]);

  /**
   * Set selected tool
   */
  const setSelectedTool = useCallback((tool: string) => {
    updateState(prev => ({
      ...prev,
      selectedTool: tool,
      selectedObjects: [] // Clear selection when changing tools
    }));
  }, [updateState]);

  /**
   * Set selected objects
   */
  const setSelectedObjects = useCallback((objectIds: string[]) => {
    updateState(prev => ({
      ...prev,
      selectedObjects: objectIds
    }));
  }, [updateState]);

  /**
   * Toggle grid visibility
   */
  const toggleGrid = useCallback(() => {
    updateState(prev => ({
      ...prev,
      gridVisible: !prev.gridVisible
    }));
  }, [updateState]);

  /**
   * Toggle snap to grid
   */
  const toggleSnap = useCallback(() => {
    updateState(prev => ({
      ...prev,
      snapEnabled: !prev.snapEnabled
    }));
  }, [updateState]);

  /**
   * Set grid size
   */
  const setGridSize = useCallback((size: number) => {
    updateState(prev => ({
      ...prev,
      gridSize: size
    }));
  }, [updateState]);

  /**
   * Undo
   */
  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const previousState = historyRef.current[historyIndexRef.current];
      const restoredState = JSON.parse(JSON.stringify(previousState));
      setState(restoredState);
      setHistoryState({
        canUndo: historyIndexRef.current > 0,
        canRedo: historyIndexRef.current < historyRef.current.length - 1
      });
    }
  }, []);

  /**
   * Redo
   */
  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      const nextState = historyRef.current[historyIndexRef.current];
      const restoredState = JSON.parse(JSON.stringify(nextState));
      setState(restoredState);
      setHistoryState({
        canUndo: historyIndexRef.current > 0,
        canRedo: historyIndexRef.current < historyRef.current.length - 1
      });
    }
  }, []);

  /**
   * Add a new layer
   */
  const addLayer = useCallback((name?: string) => {
    updateState(prev => {
      // Generate unique ID
      const newId = `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Get max order number
      const maxOrder = prev.layers.length > 0 
        ? Math.max(...prev.layers.map(l => l.order))
        : -1;
      
      const newLayer: CADLayer = {
        id: newId,
        name: (name && name.trim()) || `?? ${prev.layers.length + 1}`,
        visible: true,
        locked: false,
        order: maxOrder + 1
      };
      
      return {
        ...prev,
        layers: [...prev.layers, newLayer],
        activeLayer: newId, // Set as active layer
        lastModified: new Date()
      };
    });
  }, [updateState]);

  /**
   * Update a layer
   */
  const updateLayer = useCallback((layerId: string, updates: Partial<CADLayer>) => {
    updateState(prev => ({
      ...prev,
      layers: prev.layers.map(layer =>
        layer.id === layerId ? { ...layer, ...updates } : layer
      ),
      lastModified: new Date()
    }));
  }, [updateState]);

  /**
   * Delete a layer
   */
  const deleteLayer = useCallback((layerId: string) => {
    updateState(prev => {
      // Don't delete if it's the last layer
      if (prev.layers.length <= 1) {
        return prev;
      }
      
      // Don't delete if layer doesn't exist
      const layerToDelete = prev.layers.find(l => l.id === layerId);
      if (!layerToDelete) {
        return prev;
      }
      
      // Get default layer ID (first layer or 'default-layer')
      const defaultLayerId = prev.layers.find(l => l.id === DEFAULT_LAYER_ID)?.id 
        || prev.layers[0].id;
      
      // Move all shapes from deleted layer to default layer
      const updatedShapes = prev.shapes.map(shape =>
        shape.layer === layerId ? { ...shape, layer: defaultLayerId } : shape
      );
      
      // Remove the layer
      const updatedLayers = prev.layers.filter(l => l.id !== layerId);
      
      // If deleted layer was active, set default layer as active
      const newActiveLayer = prev.activeLayer === layerId 
        ? defaultLayerId 
        : prev.activeLayer;
      
      return {
        ...prev,
        layers: updatedLayers,
        shapes: updatedShapes,
        activeLayer: newActiveLayer,
        lastModified: new Date()
      };
    });
  }, [updateState]);

  /**
   * Set active layer
   */
  const setActiveLayer = useCallback((layerId: string) => {
    updateState(prev => {
      // Verify layer exists
      const layerExists = prev.layers.some(l => l.id === layerId);
      if (!layerExists) {
        return prev;
      }
      
      return {
        ...prev,
        activeLayer: layerId,
        lastModified: new Date()
      };
    });
  }, [updateState]);

  return {
    state,
    setState: updateState,
    addShape,
    updateShape,
    deleteShape,
    addMeasurement,
    deleteMeasurement,
    setSelectedTool,
    setSelectedObjects,
    toggleGrid,
    toggleSnap,
    setGridSize,
    undo,
    redo,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
    // Layer management
    addLayer,
    updateLayer,
    deleteLayer,
    setActiveLayer
  };
}

/**
 * Deserialize CAD design
 */
function deserializeCADDesign(design: any): CADState {
  if (!design) {
    return createInitialCADState();
  }
  
  // If design has shapes, measurements, layers, restore them
  const defaultLayer: CADLayer = {
    id: 'default-layer',
    name: '?? ??',
    visible: true,
    locked: false,
    order: 0
  };
  
  return {
    shapes: design.shapes || [],
    measurements: design.measurements || [],
    layers: design.layers && design.layers.length > 0 ? design.layers : [defaultLayer],
    selectedTool: design.selectedTool || 'select',
    selectedObjects: design.selectedObjects || [],
    activeLayer: design.activeLayer || 'default-layer',
    gridVisible: design.gridVisible !== undefined ? design.gridVisible : true,
    gridSize: design.gridSize || 10,
    snapEnabled: design.snapEnabled !== undefined ? design.snapEnabled : true,
    showMeasurements: design.showMeasurements !== undefined ? design.showMeasurements : true,
    version: design.version || 1,
    lastModified: design.lastModified ? new Date(design.lastModified) : new Date()
  };
}


