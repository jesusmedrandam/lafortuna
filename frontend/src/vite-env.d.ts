/// <reference types="vite/client" />

interface Window {
  SGBAndroid?: {
    saveBase64File?: (dataUrl: string, filename: string, mimeType: string) => boolean;
  };
}
