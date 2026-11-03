'use client';
import React from 'react';

export type FormErrorMap = Record<string, string>;

type BackendValidationDetail = {
  path?: string;
  param?: string;
  field?: string;
  name?: string;
  msg?: string;
  message?: string;
};

const toErrorDetails = (errorData: any): BackendValidationDetail[] => {
  if (Array.isArray(errorData?.details)) return errorData.details;
  if (Array.isArray(errorData?.errors)) return errorData.errors;
  return [];
};

const normalizeErrorPath = (path: string, aliases?: Record<string, string>) => aliases?.[path] || path;

export const mapBackendValidationErrors = (
  errorData: any,
  aliases?: Record<string, string>
): FormErrorMap => {
  const mapped: FormErrorMap = {};

  toErrorDetails(errorData).forEach((detail) => {
    const rawPath = detail.path || detail.param || detail.field || detail.name;
    const message = detail.msg || detail.message;
    if (!rawPath || !message) return;

    const path = normalizeErrorPath(String(rawPath), aliases);
    if (!mapped[path]) mapped[path] = String(message);
  });

  return mapped;
};

export const getBackendErrorMessage = (errorData: any, fallback: string) => {
  const detailMessage = toErrorDetails(errorData)
    .map((detail) => detail.msg || detail.message)
    .filter(Boolean)
    .join('، ');

  return detailMessage || errorData?.error || fallback;
};

export const mapAxiosFormErrors = (
  error: any,
  fallback: string,
  aliases?: Record<string, string>
): FormErrorMap => {
  const errorData = error?.response?.data || error;
  const fieldErrors = mapBackendValidationErrors(errorData, aliases);

  if (Object.keys(fieldErrors).length > 0) return fieldErrors;

  return {
    general: getBackendErrorMessage(errorData, fallback)
  };
};

export function InlineFieldError({
  id,
  message,
  className = 'text-[var(--sds-danger)] text-sm mt-1'
}: {
  id?: string;
  message?: string;
  className?: string;
}) {
  if (!message) return null;

  return (
    <p id={id} className={className} role="alert">
      {message}
    </p>
  );
}
