'use client';

import React from 'react';
import {
  calculateLongitudinalProduct,
  calculateSlab,
  type LongitudinalProductCalculation,
  type LongitudinalProductInput,
  type SlabCalculation,
  type SlabPolicyInput
} from '@sabalanerp/contract-product-graph';

type CalculationState<Result> = {
  calculation: Result | null;
  calculating: boolean;
  error: string | null;
};

type WorkerResponse<Result> = {
  id: number;
  calculation?: Result;
  error?: string;
};

const useWorkerCalculation = <Input, Result>({
  kind,
  input,
  fallback
}: {
  kind: 'longitudinal' | 'slab';
  input: Input | undefined;
  fallback: (input: Input) => Result;
}): CalculationState<Result> => {
  const [state, setState] = React.useState<CalculationState<Result>>({
    calculation: null,
    calculating: Boolean(input),
    error: null
  });
  const sequenceRef = React.useRef(0);

  React.useEffect(() => {
    if (!input) {
      setState({ calculation: null, calculating: false, error: null });
      return;
    }

    const id = sequenceRef.current + 1;
    sequenceRef.current = id;
    setState({
      calculation: null,
      calculating: true,
      error: null
    });

    if (typeof Worker === 'undefined') {
      try {
        setState({
          calculation: fallback(input),
          calculating: false,
          error: null
        });
      } catch (error) {
        setState({
          calculation: null,
          calculating: false,
          error: error instanceof Error ? error.message : 'Calculation failed'
        });
      }
      return;
    }

    const worker = new Worker(
      new URL(
        '../workers/canonicalProductCalculation.worker.ts',
        import.meta.url
      )
    );
    worker.onmessage = (event: MessageEvent<WorkerResponse<Result>>) => {
      if (event.data.id !== sequenceRef.current) return;
      setState({
        calculation: event.data.calculation ?? null,
        calculating: false,
        error: event.data.error ?? null
      });
      worker.terminate();
    };
    worker.onerror = event => {
      if (id !== sequenceRef.current) return;
      setState({
        calculation: null,
        calculating: false,
        error: event.message || 'Calculation failed'
      });
      worker.terminate();
    };
    worker.postMessage({ id, kind, input });
    return () => worker.terminate();
  }, [fallback, input, kind]);

  return state;
};

const calculateLongitudinal = (input: LongitudinalProductInput) =>
  calculateLongitudinalProduct(input);
const calculateSlabInput = (input: SlabPolicyInput) => calculateSlab(input);

export const useLongitudinalCalculationWorker = (
  input: LongitudinalProductInput | undefined
) => useWorkerCalculation<LongitudinalProductInput, LongitudinalProductCalculation>({
  kind: 'longitudinal',
  input,
  fallback: calculateLongitudinal
});

export const useSlabCalculationWorker = (
  input: SlabPolicyInput | undefined
) => useWorkerCalculation<SlabPolicyInput, SlabCalculation>({
  kind: 'slab',
  input,
  fallback: calculateSlabInput
});
