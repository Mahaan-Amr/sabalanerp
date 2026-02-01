/**
 * Core CAD types and interfaces
 */

export interface CADState {
  shapes: CADShape[];
  measurements: Measurement[];
  layers: CADLayer[];
  selectedTool: string;
  selectedObjects: string[];
  activeLayer: string;
  gridVisible: boolean;
  gridSize: number;
  snapEnabled: boolean;
  showMeasurements: boolean;
  version: number;
  lastModified: Date;
}

export interface CADShape {
  id: string;
  type: 'rectangle' | 'circle' | 'line' | 'freehand' | 'text';
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius?: number;
  points?: number[];
  text?: string; // For text shapes
  fontSize?: number; // For text shapes
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  layer: string;
  metadata?: {
    representsCut?: boolean;
    representsRemaining?: boolean;
    cost?: number;
    dimensions?: {
      length?: number;
      width?: number;
      squareMeters?: number;
    };
  };
}

export interface Measurement {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  distance: number; // in cm
  labelX: number;
  labelY: number;
}

export interface CADLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  order: number;
}

export interface CADDesign {
  version: string;
  shapes: CADShape[];
  measurements: Measurement[];
  layers: CADLayer[];
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    productType: string;
    stoneDimensions: {
      length: number;
      width: number;
    };
  };
}

export interface CoordinateSystem {
  scale: number; // Pixels per cm
  originX: number;
  originY: number;
}

export interface CalculatedDimensions {
  length?: number; // meters
  width?: number; // cm
  squareMeters?: number;
}

