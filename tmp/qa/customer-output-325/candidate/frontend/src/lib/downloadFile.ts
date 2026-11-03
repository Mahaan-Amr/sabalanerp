import type { AxiosResponse } from 'axios';

const getFilenameFromDisposition = (disposition?: string): string | null => {
  if (!disposition) return null;

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1].replace(/"/g, ''));

  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || null;
};

export const downloadBlobResponse = (response: AxiosResponse<Blob>, fallbackFilename: string) => {
  const filename =
    getFilenameFromDisposition(response.headers?.['content-disposition']) ||
    fallbackFilename;
  const blob = response.data instanceof Blob
    ? response.data
    : new Blob([response.data], { type: response.headers?.['content-type'] || 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};
