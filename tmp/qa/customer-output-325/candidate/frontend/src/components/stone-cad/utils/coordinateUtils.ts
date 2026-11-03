/**
 * Coordinate conversion utilities
 * Handles conversion between real-world units (cm, meters) and canvas pixels
 */

import { CoordinateSystem } from '../types/CADTypes';

/**
 * Initialize coordinate system based on stone dimensions and canvas size
 */
export function initializeCoordinateSystem(
  stoneLengthCm: number,
  stoneWidthCm: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 50
): CoordinateSystem {
  // Calculate available space
  const availableWidth = canvasWidth - (padding * 2);
  const availableHeight = canvasHeight - (padding * 2);
  
  // Calculate scale to fit stone in canvas
  const scaleX = availableWidth / stoneWidthCm;
  const scaleY = availableHeight / stoneLengthCm;
  const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
  
  // Center the stone
  const scaledWidth = stoneWidthCm * scale;
  const scaledHeight = stoneLengthCm * scale;
  const originX = (canvasWidth - scaledWidth) / 2;
  const originY = (canvasHeight - scaledHeight) / 2;
  
  return { scale, originX, originY };
}

/**
 * Convert real-world coordinates (cm) to canvas coordinates (pixels)
 */
export function realToCanvas(
  realX: number, // cm
  realY: number, // cm
  coordSystem: CoordinateSystem
): { x: number; y: number } {
  return {
    x: coordSystem.originX + (realX * coordSystem.scale),
    y: coordSystem.originY + (realY * coordSystem.scale)
  };
}

/**
 * Convert canvas coordinates (pixels) to real-world coordinates (cm)
 */
export function canvasToReal(
  canvasX: number,
  canvasY: number,
  coordSystem: CoordinateSystem
): { x: number; y: number } {
  return {
    x: (canvasX - coordSystem.originX) / coordSystem.scale,
    y: (canvasY - coordSystem.originY) / coordSystem.scale
  };
}

/**
 * Convert length from real units to canvas pixels
 */
export function realLengthToCanvas(
  realLength: number, // cm
  coordSystem: CoordinateSystem
): number {
  return realLength * coordSystem.scale;
}

/**
 * Convert length from canvas pixels to real units
 */
export function canvasLengthToReal(
  canvasLength: number,
  coordSystem: CoordinateSystem
): number {
  return canvasLength / coordSystem.scale;
}

