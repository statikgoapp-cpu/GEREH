import { Sidebar } from "@/components/Sidebar";
import { UploadZone } from "@/components/UploadZone";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function NewPattern() {
  return (
    <div className="flex min-h-screen bg-background font-sans">
      <Sidebar />
      
      <main className="flex-1 ml-64 p-8 bg-grid-pattern min-h-screen flex flex-col">
        <header className="mb-12">
          <Link href="/">
            <button className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors mb-6 text-sm font-medium">
              <ArrowLeft className="w-4 h-4" /> Back to Dashboard
            </button>
          </Link>
          <h1 className="text-3xl font-display font-bold text-foreground">Digitize New Pattern</h1>
          <p className="text-muted-foreground mt-2">
            Upload a raster image to extract clean vector paths automatically.
          </p>
        </header>

        <div className="flex-1 flex items-center justify-center pb-20">
          <UploadZone />
        </div>
      </main>
    </div>
  );
}
