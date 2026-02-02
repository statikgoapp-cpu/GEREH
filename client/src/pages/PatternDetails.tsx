import { Sidebar } from "@/components/Sidebar";
import { usePattern } from "@/hooks/use-patterns";
import { useParams, Link } from "wouter";
import { 
  ArrowLeft, 
  Download, 
  Share2, 
  Trash2, 
  Loader2, 
  AlertTriangle,
  FileCode,
  Image as ImageIcon,
  CheckCircle2,
  RefreshCw
} from "lucide-react";
import { motion } from "framer-motion";

export default function PatternDetails() {
  const { id } = useParams();
  const patternId = Number(id);
  const { data: pattern, isLoading, error } = usePattern(patternId);

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 ml-64 flex items-center justify-center">
          <div className="flex flex-col items-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground font-medium">Loading pattern data...</p>
          </div>
        </main>
      </div>
    );
  }

  if (error || !pattern) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 ml-64 flex items-center justify-center">
          <div className="text-center">
            <AlertTriangle className="w-12 h-12 text-yellow-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold">Pattern not found</h2>
            <Link href="/" className="text-primary hover:underline mt-4 block">Return home</Link>
          </div>
        </main>
      </div>
    );
  }

  const isProcessing = pattern.status === "processing" || pattern.status === "pending";
  const isFailed = pattern.status === "failed";
  const isCompleted = pattern.status === "completed";

  return (
    <div className="flex min-h-screen bg-background font-sans">
      <Sidebar />
      
      <main className="flex-1 ml-64 p-8 bg-grid-pattern min-h-screen">
        <header className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8 border-b border-border pb-6">
          <div>
            <Link href="/">
              <button className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors mb-4 text-sm font-medium group">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Back to Dashboard
              </button>
            </Link>
            <div className="flex items-center gap-4">
              <h1 className="text-3xl font-display font-bold text-foreground">Pattern #{pattern.id}</h1>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold border flex items-center gap-1.5
                ${isCompleted ? 'bg-green-50 text-green-700 border-green-200' : 
                  isProcessing ? 'bg-blue-50 text-blue-700 border-blue-200' : 
                  'bg-red-50 text-red-700 border-red-200'}`}>
                {isProcessing && <Loader2 className="w-3 h-3 animate-spin" />}
                {isCompleted && <CheckCircle2 className="w-3 h-3" />}
                {pattern.status.toUpperCase()}
              </span>
            </div>
            <p className="text-muted-foreground mt-2 font-mono text-sm">
              Created on {new Date(pattern.createdAt!).toLocaleDateString()} at {new Date(pattern.createdAt!).toLocaleTimeString()}
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <button className="p-2.5 rounded-lg border border-border bg-white text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-red-50 transition-colors">
              <Trash2 className="w-5 h-5" />
            </button>
            <button className="p-2.5 rounded-lg border border-border bg-white text-muted-foreground hover:text-primary hover:border-primary/30 transition-colors">
              <Share2 className="w-5 h-5" />
            </button>
            {isCompleted && (
              <a 
                href={pattern.dxfUrl!} 
                download={`pattern-${pattern.id}.dxf`}
                className="
                  flex items-center gap-2 px-5 py-2.5 rounded-lg
                  bg-primary text-primary-foreground font-medium
                  shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 hover:bg-primary/90
                  active:translate-y-0 active:shadow-md
                  transition-all duration-200
                "
              >
                <Download className="w-5 h-5" />
                Download DXF
              </a>
            )}
          </div>
        </header>

        {/* Main Content Area */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-250px)]">
          {/* Original Image Panel */}
          <div className="flex flex-col h-full bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                Original Raster
              </div>
              <div className="text-xs text-muted-foreground font-mono">JPG</div>
            </div>
            <div className="flex-1 relative bg-[url('https://grainy-gradients.vercel.app/noise.svg')] bg-gray-50 flex items-center justify-center p-8 overflow-auto">
              <img 
                src={pattern.imageUrl} 
                alt="Original" 
                className="max-w-full max-h-full object-contain shadow-xl rounded-lg border border-black/5"
              />
            </div>
          </div>

          {/* Vector Result Panel */}
          <div className="flex flex-col h-full bg-white rounded-2xl border border-border shadow-sm overflow-hidden relative">
            <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileCode className="w-4 h-4 text-accent" />
                Processed Vector
              </div>
              <div className="text-xs text-muted-foreground font-mono">SVG/DXF</div>
            </div>
            
            <div className="flex-1 relative flex items-center justify-center p-8 bg-white overflow-hidden">
              {isProcessing ? (
                <div className="text-center">
                  <div className="relative w-24 h-24 mx-auto mb-6">
                    <div className="absolute inset-0 border-4 border-muted rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
                    <Cpu className="absolute inset-0 m-auto w-8 h-8 text-accent animate-pulse" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground">Neural Engine Processing</h3>
                  <p className="text-muted-foreground mt-2 max-w-xs mx-auto">
                    Detecting edges and converting raster paths to vector curves...
                  </p>
                </div>
              ) : isFailed ? (
                <div className="text-center p-8 bg-red-50 rounded-xl border border-red-100 max-w-md">
                  <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-red-900">Processing Failed</h3>
                  <p className="text-red-700 mt-2 text-sm">
                    The neural engine could not process this image. It might be too low resolution or have insufficient contrast.
                  </p>
                  <button className="mt-4 px-4 py-2 bg-white border border-red-200 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors flex items-center gap-2 mx-auto">
                    <RefreshCw className="w-4 h-4" /> Retry
                  </button>
                </div>
              ) : pattern.svgUrl ? (
                <div className="w-full h-full flex items-center justify-center bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px]">
                  {/* In a real app, render interactive SVG here. For now, using an img tag for the SVG URL */}
                  <img 
                    src={pattern.svgUrl} 
                    alt="Vector Result" 
                    className="max-w-full max-h-full object-contain drop-shadow-2xl"
                  />
                </div>
              ) : (
                <div className="text-muted-foreground">No preview available</div>
              )}
            </div>

            {/* Neural Processing Overlay Effect */}
            {isProcessing && (
               <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-accent/5 to-transparent mix-blend-overlay" />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// Importing CPU icon which was missed in imports
import { Cpu } from "lucide-react";
