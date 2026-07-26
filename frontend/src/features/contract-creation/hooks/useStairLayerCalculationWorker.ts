'use client';

import React from 'react';
import {
  calculateStairLayerConfiguration,
  type StairLayerCalculation
} from '@sabalanerp/contract-product-graph';
import type {
  CanonicalLayerCalculationRequest
} from '../services/stairCalculationService';

export function useStairLayerCalculationWorker(
  input: CanonicalLayerCalculationRequest | undefined
) {
  const serializedInput = input ? JSON.stringify(input) : '';
  const [state, setState] = React.useState<{
    calculation: StairLayerCalculation | null;
    calculating: boolean;
    error: string | null;
  }>({
    calculation: null,
    calculating: Boolean(input),
    error: null
  });
  const sequence = React.useRef(0);

  React.useEffect(() => {
    if (!serializedInput) {
      setState({ calculation: null, calculating: false, error: null });
      return;
    }
    const currentInput = JSON.parse(
      serializedInput
    ) as CanonicalLayerCalculationRequest;
    const id = sequence.current + 1;
    sequence.current = id;
    setState({ calculation: null, calculating: true, error: null });

    if (typeof Worker === 'undefined') {
      setState({
        calculation: calculateStairLayerConfiguration(currentInput),
        calculating: false,
        error: null
      });
      return;
    }

    const worker = new Worker(
      new URL('../workers/stairLayerCalculation.worker.ts', import.meta.url)
    );
    worker.onmessage = (event: MessageEvent<{
      id: number;
      calculation?: StairLayerCalculation;
      error?: string;
    }>) => {
      if (event.data.id !== sequence.current) return;
      setState({
        calculation: event.data.calculation || null,
        calculating: false,
        error: event.data.error || null
      });
      worker.terminate();
    };
    worker.onerror = event => {
      if (id !== sequence.current) return;
      setState({
        calculation: null,
        calculating: false,
        error: event.message || 'Calculation failed'
      });
      worker.terminate();
    };
    worker.postMessage({ id, input: currentInput });
    return () => worker.terminate();
  }, [serializedInput]);

  return state;
}
