import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, FileType, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useCreatePattern } from '@/hooks/use-patterns';
import { useLocation } from 'wouter';

type UploadDefaults = {
  stoneNormalization: boolean;
  pdfPreview: boolean;
};

const DEFAULT_UPLOAD_DEFAULTS: UploadDefaults = {
  stoneNormalization: true,
  pdfPreview: true,
};

const SETTINGS_STORAGE_KEY = "np_settings_v2";
const ALLOWED_IMAGE_MIME_MAP: Record<string, string[]> = {
  "image/jpeg": [".jpeg", ".jpg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/bmp": [".bmp"],
  "image/tiff": [".tiff", ".tif"],
};

type UploadZoneProps = {
  title?: string;
  description?: string;
  ctaLabel?: string;
  dragActiveLabel?: string;
  className?: string;
  extraFormFields?: Record<string, string | number | null | undefined>;
  allowPdf?: boolean;
  acceptedImageMimeMap?: Record<string, string[]>;
};

export function UploadZone({
  title = "Upload Pattern Image",
  description = "Drag and drop your textile pattern image here, or click to browse. Supported formats: JPG, PNG.",
  ctaLabel = "Start Digitization",
  dragActiveLabel = "Drop your pattern here",
  className,
  extraFormFields,
  allowPdf = true,
  acceptedImageMimeMap = ALLOWED_IMAGE_MIME_MAP,
}: UploadZoneProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploadDefaults, setUploadDefaults] = useState<UploadDefaults>(DEFAULT_UPLOAD_DEFAULTS);
  const createPattern = useCreatePattern();
  const [, setLocation] = useLocation();

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<UploadDefaults>;
      setUploadDefaults({
        stoneNormalization:
          typeof parsed.stoneNormalization === "boolean"
            ? parsed.stoneNormalization
            : DEFAULT_UPLOAD_DEFAULTS.stoneNormalization,
        pdfPreview:
          typeof parsed.pdfPreview === "boolean"
            ? parsed.pdfPreview
            : DEFAULT_UPLOAD_DEFAULTS.pdfPreview,
      });
    } catch {
      setUploadDefaults(DEFAULT_UPLOAD_DEFAULTS);
    }
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selected = acceptedFiles[0];
    if (selected) {
      setFile(selected);
      if (selected.type === "application/pdf" || selected.name.toLowerCase().endsWith(".pdf")) {
        setPreview(null);
      } else {
        setPreview(URL.createObjectURL(selected));
      }
    }
  }, []);

  const mergedFormFields = useMemo(() => ({
    normalizeStones: uploadDefaults.stoneNormalization ? "true" : "false",
    pdfPreview: uploadDefaults.pdfPreview ? "true" : "false",
    ...(extraFormFields ?? {}),
  }), [uploadDefaults, extraFormFields]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      ...(allowPdf ? { "application/pdf": [".pdf"] } : {}),
      ...acceptedImageMimeMap,
    },
    maxFiles: 1,
    multiple: false
  });

  const handleUpload = async () => {
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);
    if (mergedFormFields) {
      Object.entries(mergedFormFields).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          formData.append(key, String(value));
        }
      });
    }

    try {
      const result = await createPattern.mutateAsync(formData);
      setLocation(`/pattern/${result.id}`);
    } catch (error) {
      // Error handled in hook
    }
  };

  const removeFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
  };

  return (
    <div className={cn("w-full max-w-2xl mx-auto", className)}>
      <AnimatePresence mode="wait">
        {!file ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            key="dropzone"
          >
            <div
              {...getRootProps()}
              className={cn(
                "border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-300 group",
                isDragActive
                  ? "border-primary bg-primary/5 scale-[1.02]"
                  : "border-border hover:border-primary/50 hover:bg-muted/30"
              )}>
              <input {...getInputProps()} />
              <div className="flex flex-col items-center gap-4">
                <div className={cn(
                  "p-4 rounded-full bg-muted transition-colors duration-300",
                  isDragActive ? "bg-primary text-primary-foreground" : "group-hover:bg-primary/10 group-hover:text-primary"
                )}>
                  <UploadCloud className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-xl text-foreground mb-1">
                    {isDragActive ? dragActiveLabel : title}
                  </h3>
                  <p className="text-muted-foreground max-w-sm mx-auto">
                    {description}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            key="preview"
            className="bg-white rounded-2xl border border-border shadow-lg overflow-hidden"
          >
            <div className="relative h-64 bg-muted/30 flex items-center justify-center border-b border-border">
              {preview ? (
                <img
                  src={preview}
                  alt="Preview"
                  className="h-full object-contain"
                />
              ) : (
                <div className="text-sm text-muted-foreground">PDF selected</div>
              )}
              <button 
                onClick={removeFile}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/80 hover:bg-red-50 text-muted-foreground hover:text-red-500 border border-border transition-colors shadow-sm"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 bg-primary/5 rounded-lg text-primary">
                  <FileType className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-medium text-foreground">{file.name}</h4>
                  <p className="text-sm text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={removeFile}
                  disabled={createPattern.isPending}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={createPattern.isPending}
                  className="
                    flex items-center gap-2 px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium shadow-lg shadow-primary/20
                    hover:bg-primary/90 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0
                    disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
                    transition-all duration-200
                  "
                >
                  {createPattern.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    ctaLabel
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
