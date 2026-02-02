import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, FileType, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useCreatePattern } from '@/hooks/use-patterns';
import { useLocation } from 'wouter';

export function UploadZone() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const createPattern = useCreatePattern();
  const [, setLocation] = useLocation();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selected = acceptedFiles[0];
    if (selected) {
      setFile(selected);
      setPreview(URL.createObjectURL(selected));
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png']
    },
    maxFiles: 1,
    multiple: false
  });

  const handleUpload = async () => {
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);

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
    <div className="w-full max-w-2xl mx-auto">
      <AnimatePresence mode="wait">
        {!file ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            key="dropzone"
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-300 group",
              isDragActive 
                ? "border-primary bg-primary/5 scale-[1.02]" 
                : "border-border hover:border-primary/50 hover:bg-muted/30"
            )}
          >
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
                  {isDragActive ? "Drop your pattern here" : "Upload Pattern Image"}
                </h3>
                <p className="text-muted-foreground max-w-sm mx-auto">
                  Drag and drop your textile pattern image here, or click to browse. Supported formats: JPG, PNG.
                </p>
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
              <img 
                src={preview!} 
                alt="Preview" 
                className="h-full object-contain"
              />
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
                    "Start Digitization"
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
