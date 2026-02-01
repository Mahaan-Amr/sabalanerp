// Wizard Progress Bar Component
// Displays the progress indicator with step icons

import React from 'react';
import { FaCheck } from 'react-icons/fa';

export interface WizardStep {
  id: number;
  title: string;
  titleEn: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

interface WizardProgressBarProps {
  currentStep: number;
  steps: WizardStep[];
}

export const WizardProgressBar: React.FC<WizardProgressBarProps> = ({ currentStep, steps }) => {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between relative z-0">
        {/* Progress Line */}
        <div className="absolute top-6 left-6 right-6 h-0.5 bg-gray-200 dark:bg-gray-700 -z-10">
          <div 
            className="h-full bg-gradient-to-r from-teal-500 to-teal-400 transition-all duration-500 ease-out"
            style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
          />
        </div>
        
        {steps.map((step) => {
          const Icon = step.icon;
          const isActive = currentStep === step.id;
          const isCompleted = currentStep > step.id;
          const isUpcoming = currentStep < step.id;
          
          return (
            <div key={step.id} className="flex flex-col items-center relative z-0">
              <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 transition-all duration-300 transform ${
                isCompleted 
                  ? 'bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-lg shadow-teal-500/25 scale-105' 
                  : isActive 
                    ? 'bg-gradient-to-br from-teal-100 to-teal-200 dark:from-teal-900/50 dark:to-teal-800/50 text-teal-600 dark:text-teal-400 border-2 border-teal-500 shadow-lg shadow-teal-500/20 scale-110' 
                    : 'bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-2 border-gray-200 dark:border-gray-600 shadow-sm hover:shadow-md transition-shadow'
              }`}>
                {isCompleted ? (
                  <FaCheck className="w-5 h-5" />
                ) : (
                  <Icon className={`w-5 h-5 ${isActive ? 'animate-pulse' : ''}`} />
                )}
              </div>
              <span className={`text-xs font-medium text-center max-w-20 leading-tight ${
                isActive 
                  ? 'text-teal-600 dark:text-teal-400 font-semibold' 
                  : isCompleted
                    ? 'text-teal-500 dark:text-teal-400'
                    : 'text-gray-500 dark:text-gray-400'
              }`}>
                {step.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

