"use client";

import React from "react";

export interface Step {
  id: string;
  label: string;
}

interface StepperProps {
  steps: Step[];
  activeStepId: string;
  onStepChange?: (id: string) => void;
}

export default function Stepper({
  steps,
  activeStepId,
  onStepChange,
}: StepperProps) {
  const activeIndex = steps.findIndex((step) => step.id === activeStepId);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = step.id === activeStepId;
          const isCompleted = index < activeIndex;
          const isClickable = onStepChange && (isCompleted || isActive);

          return (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center flex-1">
                <button
                  type="button"
                  onClick={() => isClickable && onStepChange?.(step.id)}
                  disabled={!isClickable}
                  className={`
                    flex items-center justify-center w-10 h-10 rounded-full border-2 transition-colors
                    ${
                      isActive
                        ? "bg-blue-600 border-blue-600 text-white"
                        : isCompleted
                        ? "bg-green-500 border-green-500 text-white"
                        : "bg-white border-gray-300 text-gray-400"
                    }
                    ${isClickable ? "cursor-pointer hover:opacity-80" : "cursor-not-allowed"}
                  `}
                >
                  {isCompleted ? (
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <span className="font-semibold">{index + 1}</span>
                  )}
                </button>
                <span
                  className={`
                    mt-2 text-sm font-medium
                    ${isActive ? "text-blue-600" : isCompleted ? "text-green-600" : "text-gray-400"}
                  `}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`
                    flex-1 h-0.5 mx-4 -mt-5
                    ${index < activeIndex ? "bg-green-500" : "bg-gray-300"}
                  `}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

