'use client';

import React from 'react';

export interface StairSystemModalV2Props {
  isOpen: boolean;
  onClose: () => void;
}

export const StairSystemModalV2: React.FC<StairSystemModalV2Props> = ({ isOpen }) => {
  if (!isOpen) {
    return null;
  }

  return null;
};

export default StairSystemModalV2;
